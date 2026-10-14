import {
  AutomationLimitError,
  type AutomationDraft,
  type AutomationRecord,
  type AutomationsRepo,
  type ChannelRecord,
  type ConnectionsRepo,
  type GroupRecord,
  type SecretVault,
  type ShopeeCredentialRecord,
} from "./ports";

let seq = 0;
const nextId = (p: string) => `${p}_${(++seq).toString(36)}`;

export class MemoryVault implements SecretVault {
  /** Só para testes provarem que o valor foi parar no cofre e não em outro lugar. */
  readonly stored = new Map<string, string>();
  async put(accountId: string, kind: string, value: string) {
    const id = nextId(`vault_${kind}`);
    this.stored.set(id, `${accountId}:${value}`);
    return id;
  }
}

export class MemoryConnections implements ConnectionsRepo {
  private shopee = new Map<string, ShopeeCredentialRecord>();
  private channels = new Map<string, ChannelRecord>();
  private groups = new Map<string, GroupRecord[]>();

  async getShopee(a: string) { return this.shopee.get(a) ?? null; }
  async saveShopee(r: ShopeeCredentialRecord) { this.shopee.set(r.accountId, { ...r }); }
  async getChannel(a: string) { return this.channels.get(a) ?? null; }
  async saveChannel(r: ChannelRecord) { this.channels.set(r.accountId, { ...r }); }
  async listGroups(a: string) { return (this.groups.get(a) ?? []).map((g) => ({ ...g })); }

  async syncGroups(accountId: string, found: { chatId: string; name: string; chatType: GroupRecord["chatType"]; members: number }[]) {
    const cur = this.groups.get(accountId) ?? [];
    for (const f of found) {
      const hit = cur.find((g) => g.chatId === f.chatId);
      if (hit) {
        hit.name = f.name;
        hit.members = f.members;
        continue;
      }
      cur.push({ ...f, id: nextId("grp"), accountId, subId: `tg-${String(cur.length + 1).padStart(2, "0")}-${f.chatId.replace(/\D/g, "").slice(-4) || "x"}`, active: false });
    }
    this.groups.set(accountId, cur);
    return cur.map((g) => ({ ...g }));
  }

  async setGroupActive(accountId: string, groupId: string, active: boolean) {
    const g = (this.groups.get(accountId) ?? []).find((x) => x.id === groupId);
    if (!g) return null;
    g.active = active;
    return { ...g };
  }
}

export class MemoryAutomations implements AutomationsRepo {
  private rows = new Map<string, AutomationRecord[]>();
  private clock: () => string;
  constructor(clock: () => string = () => new Date().toISOString()) { this.clock = clock; }

  async list(a: string) { return (this.rows.get(a) ?? []).map((r) => ({ ...r })); }
  async get(a: string, id: string) { const r = (this.rows.get(a) ?? []).find((x) => x.id === id); return r ? { ...r } : null; }

  async createWithinLimit(accountId: string, draft: AutomationDraft, max: number) {
    const cur = this.rows.get(accountId) ?? [];
    if (cur.length >= max) throw new AutomationLimitError();
    const rec: AutomationRecord = { ...draft, id: nextId("aut"), accountId, createdAt: this.clock() };
    this.rows.set(accountId, [...cur, rec]);
    return { ...rec };
  }

  async update(accountId: string, id: string, draft: AutomationDraft) {
    const cur = this.rows.get(accountId) ?? [];
    const i = cur.findIndex((x) => x.id === id);
    if (i < 0) return null;
    cur[i] = { ...cur[i]!, ...draft };
    return { ...cur[i]! };
  }

  async remove(accountId: string, id: string) {
    const cur = this.rows.get(accountId) ?? [];
    const next = cur.filter((x) => x.id !== id);
    this.rows.set(accountId, next);
    return next.length !== cur.length;
  }
}
