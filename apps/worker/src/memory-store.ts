import type {
  AutomationRow,
  DueGroup,
  NewSend,
  ProductOfferNode,
  SchedulerStore,
  SchedulerTx,
  SendHistoryRow,
} from "./scheduler-ports.js";

type GroupState = {
  automationId: string;
  groupId: string;
  accountId: string;
  channelId: string;
  active: boolean;
  nextRunAt: Date | null;
};

export type StoredSend = Omit<NewSend, "status" | "offerId" | "reason" | "scheduledFor"> & {
  id: string;
  createdAt: Date;
  status: SendHistoryRow["status"];
  offerId?: string | null;
  reason?: string | null;
  scheduledFor: Date;
  /** só para seeds de histórico sem oferta cadastrada */
  itemId?: string;
  sentAt?: Date;
};
type SeedSend = Omit<StoredSend, "id" | "createdAt" | "scheduledFor"> & Partial<Pick<StoredSend, "createdAt" | "scheduledFor">>;

/**
 * Implementação em memória da porta, com a semântica que o Postgres dá:
 * lock de linha com SKIP LOCKED, unicidade (account_id, idempotency_key) e
 * commit/rollback atômico. Serve de contrato executável para o adaptador SQL.
 */
export class MemoryStore implements SchedulerStore {
  readonly sends: StoredSend[] = [];
  readonly offers: { id: string; accountId: string; itemId: string; node: ProductOfferNode }[] = [];
  /** Injeta falha em setNextRunAt para provar atomicidade. */
  failNextAdvance = false;

  private automations = new Map<string, AutomationRow>();
  private groups = new Map<string, GroupState>();
  private locks = new Set<string>();
  private seq = 0;

  addAutomation(a: AutomationRow): void {
    this.automations.set(a.id, a);
  }
  addGroup(g: GroupState): void {
    this.groups.set(`${g.automationId}:${g.groupId}`, g);
  }
  automation(id: string): AutomationRow {
    const a = this.automations.get(id);
    if (!a) throw new Error(`automação ${id} inexistente`);
    return a;
  }
  group(automationId: string, groupId: string): GroupState {
    const g = this.groups.get(`${automationId}:${groupId}`);
    if (!g) throw new Error(`grupo ${groupId} inexistente`);
    return g;
  }
  seedSend(s: SeedSend): void {
    this.sends.push({ id: `seed-${++this.seq}`, createdAt: s.createdAt ?? new Date(0), scheduledFor: s.scheduledFor ?? new Date(0), ...s });
  }

  private view(g: GroupState): DueGroup {
    return {
      automationId: g.automationId,
      groupId: g.groupId,
      accountId: g.accountId,
      channelId: g.channelId,
      nextRunAt: g.nextRunAt,
      automation: this.automation(g.automationId),
    };
  }

  private isDue(g: GroupState, now: Date): boolean {
    return g.active && this.automation(g.automationId).status === "active" && (g.nextRunAt === null || g.nextRunAt.getTime() <= now.getTime());
  }

  private openSend(automationId: string, groupId: string): boolean {
    return this.sends.some(
      (s) => s.automationId === automationId && s.groupId === groupId && (s.status === "queued" || s.status === "sending"),
    );
  }

  async listDueGroups(now: Date, limit: number): Promise<DueGroup[]> {
    return [...this.groups.values()].filter((g) => this.isDue(g, now)).slice(0, limit).map((g) => this.view(g));
  }

  async listRecentSends(groupId: string, since: Date): Promise<SendHistoryRow[]> {
    return this.sends
      .filter((s) => s.groupId === groupId && s.createdAt.getTime() >= since.getTime())
      .map((s) => {
        const offer = this.offers.find((o) => o.id === s.offerId);
        return {
          itemId: offer?.itemId ?? s.itemId ?? null,
          status: s.status,
          reason: s.reason ?? null,
          sentAt: s.sentAt ?? null,
          attemptedAt: null,
          createdAt: s.createdAt,
        };
      });
  }

  async hasOpenSend(automationId: string, groupId: string): Promise<boolean> {
    return this.openSend(automationId, groupId);
  }

  async transaction<T>(fn: (tx: SchedulerTx) => Promise<T>): Promise<T> {
    const held: string[] = [];
    const stagedSends: StoredSend[] = [];
    const stagedOffers: { id: string; accountId: string; itemId: string; node: ProductOfferNode }[] = [];
    const stagedAdvance: { key: string; next: Date }[] = [];

    const tx: SchedulerTx = {
      lockGroup: async (automationId, groupId, now) => {
        const key = `${automationId}:${groupId}`;
        const g = this.groups.get(key);
        if (!g || this.locks.has(key)) return null; // SKIP LOCKED
        if (!this.isDue(g, now)) return null;
        this.locks.add(key);
        held.push(key);
        await Promise.resolve(); // cede o turno: permite intercalar outra transação
        return this.view(g);
      },
      hasOpenSend: async (automationId, groupId) =>
        this.openSend(automationId, groupId) ||
        stagedSends.some((s) => s.automationId === automationId && s.groupId === groupId && s.status === "queued"),
      upsertOffer: async (accountId, node) => {
        const itemId = String(node.itemId);
        const existing =
          this.offers.find((o) => o.accountId === accountId && o.itemId === itemId) ??
          stagedOffers.find((o) => o.accountId === accountId && o.itemId === itemId);
        if (existing) return { id: existing.id };
        const row = { id: `offer-${++this.seq}`, accountId, itemId, node };
        stagedOffers.push(row);
        return { id: row.id };
      },
      insertSend: async (send) => {
        const dup =
          this.sends.some((s) => s.accountId === send.accountId && s.idempotencyKey === send.idempotencyKey) ||
          stagedSends.some((s) => s.accountId === send.accountId && s.idempotencyKey === send.idempotencyKey);
        if (dup) return false;
        stagedSends.push({ ...send, id: `send-${++this.seq}`, createdAt: send.scheduledFor });
        return true;
      },
      setNextRunAt: async (automationId, groupId, next) => {
        if (this.failNextAdvance) {
          this.failNextAdvance = false;
          throw new Error("falha injetada ao avançar next_run_at");
        }
        stagedAdvance.push({ key: `${automationId}:${groupId}`, next });
      },
    };

    try {
      const out = await fn(tx);
      // commit
      this.offers.push(...stagedOffers);
      this.sends.push(...stagedSends);
      for (const a of stagedAdvance) {
        const g = this.groups.get(a.key);
        if (g) g.nextRunAt = a.next;
      }
      return out;
    } finally {
      for (const k of held) this.locks.delete(k);
    }
  }
}
