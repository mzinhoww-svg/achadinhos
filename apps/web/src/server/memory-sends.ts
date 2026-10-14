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
}

let seq = 0;

/** Memória que imita o contrato da RPC `enqueue_send_now`; no banco a regra vive na função SECURITY DEFINER. */
export class MemorySendNow implements SendNowRepo {
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
    };
    this.store.push(row);
    return { sendId: row.id, duplicate: false };
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
    });
  }
}
