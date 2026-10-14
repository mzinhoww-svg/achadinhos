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
  type ValidationStatus,
} from "../ports";
import type { SendRecord, SendsRepo, SendStatusValue } from "../envios-ports";
import { SendNowError, type EnqueueResult, type OfferCandidate, type SendNowRepo } from "../send-ports";
import { DbError, call, isUuid, type RpcFn } from "./rpc";

/**
 * Adaptadores Supabase (T8-10). Os parâmetros `accountId` das portas são ignorados de propósito:
 * a conta é a de `auth.uid()` dentro de cada RPC. Quem passa outro id não consegue trocar de conta.
 */

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
const date = (v: unknown) => new Date(String(v));

function group(r: Row, accountId: string): GroupRecord {
  return {
    id: String(r.id), accountId, chatId: String(r.chat_id), name: String(r.name),
    chatType: r.chat_type as GroupRecord["chatType"], subId: String(r.sub_id), active: Boolean(r.active), members: Number(r.members),
  };
}

function automation(r: Row, accountId: string): AutomationRecord {
  return {
    id: String(r.id), accountId, name: String(r.name), status: r.status as AutomationRecord["status"],
    filters: (r.filters ?? {}) as Record<string, unknown>, days: (r.days as number[]).map(Number),
    windowStart: String(r.window_start), windowEnd: String(r.window_end), frequencyMin: Number(r.frequency_min) as 15 | 30 | 60,
    header: str(r.header), footer: str(r.footer), groupIds: (r.group_ids as string[]).map(String), createdAt: new Date(String(r.created_at)).toISOString(),
  };
}

/** Conta da sessão, memorizada por instância (a instância vive uma requisição). */
class Scoped {
  private acc?: Promise<string>;
  constructor(protected readonly rpc: RpcFn) {}
  protected account(): Promise<string> {
    return (this.acc ??= call<string>(this.rpc, "web_account"));
  }
}

export class SupabaseVault extends Scoped implements SecretVault {
  async put(_accountId: string, kind: "shopee_secret" | "telegram_token", value: string) {
    return call<string>(this.rpc, "web_put_secret", { p_kind: kind, p_value: value });
  }
}

export class SupabaseConnections extends Scoped implements ConnectionsRepo {
  async getShopee(_a: string): Promise<ShopeeCredentialRecord | null> {
    const r = await call<Row | null>(this.rpc, "web_get_shopee");
    if (!r) return null;
    return {
      accountId: await this.account(), appId: String(r.app_id), secretId: String(r.secret_id), secretLast4: String(r.secret_last4 ?? ""),
      status: r.status as ValidationStatus, validatedAt: str(r.validated_at), lastError: str(r.last_error),
    } as ShopeeCredentialRecord;
  }

  async saveShopee(rec: ShopeeCredentialRecord) {
    await call(this.rpc, "web_save_shopee", { p_app_id: rec.appId, p_secret_id: rec.secretId, p_last4: (rec as { secretLast4?: string }).secretLast4 ?? "" });
  }

  async getChannel(_a: string): Promise<ChannelRecord | null> {
    const r = await call<Row | null>(this.rpc, "web_get_channel");
    if (!r) return null;
    return {
      accountId: await this.account(), secretId: String(r.secret_id), botName: String(r.bot_name),
      status: r.status as ValidationStatus, validatedAt: str(r.validated_at), lastError: str(r.last_error),
    };
  }

  async saveChannel(rec: ChannelRecord) {
    await call(this.rpc, "web_save_channel", { p_secret_id: rec.secretId, p_bot_name: rec.botName });
  }

  async listGroups(_a: string) {
    const acc = await this.account();
    return (await call<Row[]>(this.rpc, "web_list_groups")).map((r) => group(r, acc));
  }

  async syncGroups(_a: string, found: { chatId: string; name: string; chatType: GroupRecord["chatType"]; members: number }[]) {
    const acc = await this.account();
    return (await call<Row[]>(this.rpc, "web_sync_groups", { p_found: found })).map((r) => group(r, acc));
  }

  async setGroupActive(_a: string, groupId: string, active: boolean) {
    if (!isUuid(groupId)) return null;
    const r = await call<Row | null>(this.rpc, "web_set_group_active", { p_group_id: groupId, p_active: active });
    return r ? group(r, await this.account()) : null;
  }
}

const LIMIT_RE = /automation_limit|automation limit exceeded/;

export class SupabaseAutomations extends Scoped implements AutomationsRepo {
  async list(_a: string) {
    const acc = await this.account();
    return (await call<Row[]>(this.rpc, "web_list_automations")).map((r) => automation(r, acc));
  }

  async get(_a: string, id: string) {
    if (!isUuid(id)) return null;
    const rows = await call<Row[]>(this.rpc, "web_list_automations", { p_id: id });
    return rows[0] ? automation(rows[0], await this.account()) : null;
  }

  async createWithinLimit(_a: string, draft: AutomationDraft, max: number) {
    try {
      const r = await call<Row>(this.rpc, "web_create_automation", { p_draft: draft, p_max: max });
      return automation(r, await this.account());
    } catch (e) {
      if (e instanceof DbError && LIMIT_RE.test(e.pgMessage)) throw new AutomationLimitError();
      throw e;
    }
  }

  async update(_a: string, id: string, draft: AutomationDraft) {
    if (!isUuid(id)) return null;
    const r = await call<Row | null>(this.rpc, "web_update_automation", { p_id: id, p_draft: draft });
    return r ? automation(r, await this.account()) : null;
  }

  async remove(_a: string, id: string) {
    if (!isUuid(id)) return false;
    return call<boolean>(this.rpc, "web_remove_automation", { p_id: id });
  }
}

function offer(r: Row): OfferCandidate {
  const raw = (r.raw ?? {}) as Row;
  const hue = raw.placeholderHue;
  return {
    itemId: String(r.item_id), title: String(r.title ?? ""), imageUrl: String(r.image_url ?? ""), productLink: String(r.product_url ?? ""),
    offerLink: String(raw.offerLink ?? r.product_url ?? ""), price: Number(r.price), oldPrice: Number(r.original_price ?? r.price),
    commissionRate: Number(r.commission_rate ?? 0), rating: Number(r.rating ?? 0), sales: Number(r.sales ?? 0), shopName: String(raw.shopName ?? ""),
    ...(typeof hue === "number" ? { placeholderHue: hue } : {}),
  };
}

export class SupabaseSends extends Scoped implements SendNowRepo, SendsRepo {
  async saveOffer(_a: string, o: OfferCandidate) {
    return call<string>(this.rpc, "web_save_offer", { p_offer: o });
  }

  async enqueueSendNow(_a: string, groupId: string, offerId: string): Promise<EnqueueResult> {
    if (!isUuid(groupId) || !isUuid(offerId)) throw new SendNowError("forbidden");
    try {
      const r = await call<{ send_id: string; duplicate: boolean }>(this.rpc, "web_enqueue_send_now", { p_group_id: groupId, p_offer_id: offerId });
      return { sendId: r.send_id, duplicate: r.duplicate };
    } catch (e) {
      if (e instanceof DbError) {
        if (/group_inactive/.test(e.pgMessage)) throw new SendNowError("group_inactive");
        if (/forbidden|unauthenticated/.test(e.pgMessage)) throw new SendNowError("forbidden");
      }
      throw e;
    }
  }

  async listOffers(_a: string) {
    return (await call<Row[]>(this.rpc, "web_list_offers")).map(offer);
  }

  async recentSent(_a: string, itemId: string, groupIds: string[], since: Date) {
    const rows = await call<{ group_id: string; at: string }[]>(this.rpc, "web_recent_sent", {
      p_item_id: itemId, p_group_ids: groupIds, p_since: since.toISOString(),
    });
    return rows.map((r) => ({ groupId: r.group_id, at: date(r.at) }));
  }

  async timezone(_a: string) {
    return call<string>(this.rpc, "web_account_timezone");
  }

  async list(_a: string, since: Date): Promise<SendRecord[]> {
    const rows = await call<Row[]>(this.rpc, "web_list_sends", { p_since: since.toISOString() });
    return rows.map((r) => ({
      id: String(r.id), status: r.status as SendStatusValue, reason: str(r.reason), priority: Number(r.priority),
      groupId: str(r.group_id), scheduledFor: date(r.scheduled_for), sentAt: r.sent_at ? date(r.sent_at) : null,
      offerTitle: str(r.offer_title), groupName: str(r.group_name), automationName: str(r.automation_name), shortLink: str(r.short_link),
    }));
  }
}

export function createSupabaseRepos(rpc: RpcFn) {
  const sends = new SupabaseSends(rpc);
  return {
    connections: new SupabaseConnections(rpc),
    automations: new SupabaseAutomations(rpc),
    vault: new SupabaseVault(rpc),
    sendNow: sends as SendNowRepo,
    sends: sends as SendsRepo,
  };
}
