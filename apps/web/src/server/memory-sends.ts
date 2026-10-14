import type { SendRecord, SendStatusValue, SendsRepo } from "./envios-ports";
import type { ConnectionsRepo } from "./ports";
import { SendNowError, type EnqueueResult, type OfferCandidate, type SendNowRepo } from "./send-ports";

export interface SendRow {
  id: string;
  accountId: string;
  groupId: string;
  offerId: string;
  itemId: string;
  status: "queued" | "sending" | "sent" | "failed" | "skipped";
  priority: number;
  idempotencyKey: string;
  scheduledFor: Date;
  sentAt: Date | null;
  reason: string | null;
  automationName: string | null;
  shortLink: string | null;
}

let seq = 0;

/** Memória que imita o contrato da RPC `enqueue_send_now`; no banco a regra vive na função SECURITY DEFINER. */
export class MemorySendNow implements SendNowRepo, SendsRepo {
  private offers = new Map<string, { id: string; offer: OfferCandidate }>();
  private store: SendRow[] = [];

  constructor(
    private readonly connections: ConnectionsRepo,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async saveOffer(accountId: string, offer: OfferCandidate) {
    const key = `${accountId}:${offer.itemId}`;
    const hit = this.offers.get(key);
    if (hit) {
      hit.offer = offer;
      return hit.id;
    }
    const id = `off_${(++seq).toString(36)}`;
    this.offers.set(key, { id, offer });
    return id;
  }

  async enqueueSendNow(accountId: string, groupId: string, offerId: string): Promise<EnqueueResult> {
    const group = (await this.connections.listGroups(accountId)).find((g) => g.id === groupId);
    if (!group) throw new SendNowError("forbidden");
    const offer = [...this.offers.entries()].find(([k, v]) => k.startsWith(`${accountId}:`) && v.id === offerId);
    if (!offer) throw new SendNowError("forbidden");
    if (!group.active) throw new SendNowError("group_inactive");

    const key = `now:${groupId}:${offerId}:${Math.floor(this.now().getTime() / 60_000)}`;
    const existing = this.store.find(
      (s) => s.accountId === accountId && (s.idempotencyKey === key || (s.groupId === groupId && s.offerId === offerId && (s.status === "queued" || s.status === "sending"))),
    );
    if (existing) return { sendId: existing.id, duplicate: true };
    const row: SendRow = {
      id: `snd_${(++seq).toString(36)}`, accountId, groupId, offerId, itemId: offer[1].offer.itemId,
      status: "queued", priority: 100, idempotencyKey: key, scheduledFor: this.now(), sentAt: null,
      reason: null, automationName: null, shortLink: null,
    };
    this.store.push(row);
    return { sendId: row.id, duplicate: false };
  }

  async listOffers(accountId: string) {
    return [...this.offers.entries()]
      .filter(([k]) => k.startsWith(`${accountId}:`))
      .map(([, v]) => ({ ...v.offer }))
      .reverse();
  }

  async recentSent(accountId: string, itemId: string, groupIds: string[], since: Date) {
    return this.store
      .filter((s) => s.accountId === accountId && s.itemId === itemId && s.status === "sent" && s.sentAt && s.sentAt >= since && groupIds.includes(s.groupId))
      .map((s) => ({ groupId: s.groupId, at: s.sentAt! }));
  }

  rows(accountId: string): SendRow[] {
    return this.store.filter((s) => s.accountId === accountId).map((s) => ({ ...s }));
  }

  /** Só para testes e para a semente do modo demo. */
  markSent(accountId: string, groupId: string, itemId: string, at: Date) {
    this.store.push({
      id: `snd_${(++seq).toString(36)}`, accountId, groupId, offerId: "hist", itemId, status: "sent", priority: 0,
      idempotencyKey: `hist:${groupId}:${itemId}:${at.getTime()}`, scheduledFor: at, sentAt: at,
      reason: null, automationName: null, shortLink: null,
    });
  }

  /** Só para testes e para a semente do modo demo: linha de histórico com status e horário arbitrários. */
  seed(o: { accountId: string; groupId: string; offerId: string; status: SendStatusValue; at: Date; reason?: string; priority?: number; automationName?: string; shortLink?: string }) {
    const item = [...this.offers.entries()].find(([k, v]) => k.startsWith(`${o.accountId}:`) && v.id === o.offerId);
    const row: SendRow = {
      id: `snd_${(++seq).toString(36)}`, accountId: o.accountId, groupId: o.groupId, offerId: o.offerId,
      itemId: item?.[1].offer.itemId ?? "", status: o.status, priority: o.priority ?? 0,
      idempotencyKey: `seed:${seq}`, scheduledFor: o.at, sentAt: o.status === "sent" ? o.at : null,
      reason: o.reason ?? null, automationName: o.automationName ?? null, shortLink: o.shortLink ?? null,
    };
    this.store.push(row);
    return row.id;
  }

  /** Simula o worker (claim/finish) para testes e demo. Só avança; estado final não muda. */
  transition(accountId: string, id: string, status: SendStatusValue, reason?: string): boolean {
    const r = this.store.find((s) => s.accountId === accountId && s.id === id);
    if (!r || r.status === "sent" || r.status === "failed" || r.status === "skipped") return false;
    r.status = status;
    r.reason = reason ?? null;
    if (status === "sent") r.sentAt = this.now();
    return true;
  }

  async timezone(_accountId: string) {
    return "America/Cuiaba";
  }

  async list(accountId: string, since: Date): Promise<SendRecord[]> {
    const groups = await this.connections.listGroups(accountId);
    return this.store
      .filter((s) => s.accountId === accountId && (s.status === "queued" || s.status === "sending" || (s.sentAt ?? s.scheduledFor) >= since))
      .map((s) => {
        const offer = [...this.offers.entries()].find(([k, v]) => k.startsWith(`${accountId}:`) && v.id === s.offerId);
        const g = groups.find((x) => x.id === s.groupId);
        return {
          id: s.id, status: s.status, reason: s.reason, priority: s.priority, groupId: g?.id ?? null,
          scheduledFor: s.scheduledFor, sentAt: s.sentAt, offerTitle: offer?.[1].offer.title ?? null,
          groupName: g?.name ?? null, automationName: s.automationName,
          shortLink: s.shortLink ?? (offer ? null : null),
        };
      });
  }
}
