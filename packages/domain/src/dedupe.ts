export const REPEATED = "repetida";
export const DEDUPE_DAYS_DEFAULT = 7;

export interface SendLike extends Record<string, unknown> {
  group_id?: string;
  groupId?: string;
  group?: string;
  item_id?: string | number;
  itemId?: string | number;
  offer_id?: string;
  offerId?: string;
  offer?: { item_id?: string | number; itemId?: string | number } | null;
  status?: string;
  sent_at?: Date | string | number | null;
  sentAt?: Date | string | number | null;
  scheduled_for?: Date | string | number | null;
  scheduledFor?: Date | string | number | null;
  created_at?: Date | string | number | null;
  createdAt?: Date | string | number | null;
}

export interface DedupeCheckInput {
  history?: SendLike[];
  sends?: SendLike[];
  records?: SendLike[];
  groupId?: string;
  group_id?: string;
  group?: string;
  itemId?: string | number;
  item_id?: string | number;
  now?: Date | string | number;
  asOf?: Date | string | number;
  date?: Date | string | number;
  days?: number;
  dedupeDays?: number;
  dedupe_days?: number;
}

function asDate(v: unknown): Date | null {
  if (v == null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const d = new Date(v as string | number);
  return Number.isNaN(d.getTime()) ? null : d;
}

function groupIdOf(s: SendLike): string | undefined {
  return (s.group_id ?? s.groupId ?? s.group) as string | undefined;
}

function itemIdOf(s: SendLike): string | number | undefined {
  if (s.item_id !== undefined || s.itemId !== undefined) return (s.item_id ?? s.itemId)!;
  if (s.offer && typeof s.offer === "object") {
    return (s.offer.item_id ?? s.offer.itemId) as string | number | undefined;
  }
  return undefined;
}

function dateOf(s: SendLike): Date | null {
  return asDate(s.sent_at ?? s.sentAt ?? s.scheduled_for ?? s.scheduledFor ?? s.created_at ?? s.createdAt);
}

function isBlockingStatus(status: unknown): boolean {
  // failed with unknown result blocks too; skipped repeated doesn't block
  if (status == null) return true;
  const s = String(status).toLowerCase();
  if (s === "skipped") return false;
  return true;
}

export function dedupeDays(input: DedupeCheckInput | number = DEDUPE_DAYS_DEFAULT): number {
  if (typeof input === "number") return input;
  return (
    input.dedupeDays ?? input.dedupe_days ?? input.days ?? DEDUPE_DAYS_DEFAULT
  ) as number;
}

export function isRepeated(
  input: DedupeCheckInput | SendLike[] = {},
  ...rest: unknown[]
): boolean {
  // support isRepeated(history, groupId, itemId, now?, days?)
  let history: SendLike[] = [];
  let groupId: string | undefined;
  let itemId: string | number | undefined;
  let now: Date = new Date();
  let days = DEDUPE_DAYS_DEFAULT;

  if (Array.isArray(input)) {
    history = input as SendLike[];
    if (typeof rest[0] === "string" || typeof rest[0] === "number") groupId = rest[0] as string;
    if (rest[1] !== undefined) itemId = rest[1] as string | number;
    if (rest[2]) now = rest[2] instanceof Date ? rest[2] : new Date(rest[2] as string | number);
    if (rest[3]) days = Number(rest[3]);
  } else if (input && typeof input === "object") {
    const o = input as DedupeCheckInput;
    history = (o.history ?? o.sends ?? o.records ?? []) as SendLike[];
    groupId = (o.groupId ?? o.group_id ?? o.group) as string | undefined;
    itemId = (o.itemId ?? o.item_id) as string | number | undefined;
    const d = o.now ?? o.asOf ?? o.date;
    if (d) now = d instanceof Date ? d : new Date(d as string | number);
    days = (o.dedupeDays ?? o.dedupe_days ?? o.days ?? days) as number;
  }

  if (groupId == null || itemId == null) return false;
  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
  return history.some((s) => {
    if (groupIdOf(s) !== groupId) return false;
    if (String(itemIdOf(s)) !== String(itemId)) return false;
    if (!isBlockingStatus(s.status)) return false;
    const dt = dateOf(s);
    if (!dt) return false;
    return dt.getTime() >= cutoff && dt.getTime() <= now.getTime() + 60_000;
  });
}

export function checkDedupe(input: DedupeCheckInput): { repeated: boolean; reason?: string } {
  const repeated = isRepeated(input);
  return repeated ? { repeated: true, reason: REPEATED } : { repeated: false };
}

export const isRepeatedSend = isRepeated;
export const isDuplicate = isRepeated;
export const wasSentRecently = isRepeated;

export function filterNotRepeated<T extends { item_id?: unknown; itemId?: unknown; offer?: unknown }>(
  offers: T[],
  history: SendLike[],
  input: Omit<DedupeCheckInput, "history" | "sends" | "records" | "itemId" | "item_id"> & { groupId?: string; group_id?: string; group?: string; now?: Date | string | number; days?: number } = {},
): T[] {
  const groupId = input.groupId ?? input.group_id ?? input.group;
  const now = input.now ? (input.now instanceof Date ? input.now : new Date(input.now as string | number)) : new Date();
  const days = input.days ?? DEDUPE_DAYS_DEFAULT;
  return offers.filter((offer) => {
    const itemId = (offer as { item_id?: unknown; itemId?: unknown }).item_id ?? (offer as { itemId?: unknown }).itemId;
    const repeated = isRepeated({ history, groupId: groupId as string, itemId: itemId as string | number, now, days });
    return !repeated;
  });
}

export function sevenDayDedupe(input: DedupeCheckInput): boolean {
  return isRepeated(input);
}

export const dedupe = isRepeated;
export const isDeduped = isRepeated;
export const antiRepeat = isRepeated;
export const recentSend = isRepeated;
