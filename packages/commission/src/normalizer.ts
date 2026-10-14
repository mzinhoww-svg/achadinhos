import type { Commission, ConversionReportNode } from "./types.js";

export function toSeconds(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value >= 1_000_000_000_000 ? Math.floor(value / 1000) : value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed >= 1_000_000_000_000 ? Math.floor(parsed / 1000) : parsed;
    }
  }
  return undefined;
}

function asNumber(value: unknown, fallback?: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (fallback !== undefined) return fallback;
  throw new Error(`invalid commission value: ${String(value)}`);
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (value === undefined || value === null) return [];
  return [String(value).trim()].filter(Boolean);
}

function parseUtmContent(utmContent: string): string[] {
  const candidates = [",", "_", "-", "|", "/", ";", " "];
  for (const separator of candidates) {
    const parts = utmContent.split(separator).map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 3 && parts.length <= 6) return parts;
  }
  return [utmContent.trim()].filter(Boolean);
}

function mapShopeeStatus(raw: unknown, orders: unknown[]): string {
  let candidates: unknown[] = [raw];
  if (orders.length > 0) {
    candidates = orders.map((o) => (o as Record<string, unknown> | null)?.orderStatus ?? (o as Record<string, unknown> | null)?.status);
    if (raw !== undefined && raw !== null && raw !== "") candidates = [raw, ...candidates];
  }

  const normalized = candidates
    .map((v) => String(v ?? "").trim().toLowerCase())
    .filter(Boolean);

  if (normalized.length === 0) return "pending";

  const states = normalized.map((v) => {
    if (v === "cancelled" || v === "canceled" || v === "rejected" || v === "failed" || v === "invalid") return "cancelled";
    if (v === "paid" || v === "settled" || v === "completed_paid") return "paid";
    if (v === "confirmed" || v === "approved" || v === "completed" || v === "complete" || v === "success") return "confirmed";
    if (v === "pending" || v === "processing" || v === "waiting") return "pending";
    return "pending";
  });

  if (states.every((s) => s === "cancelled")) return "cancelled";
  if (states.every((s) => s === "paid")) return "paid";
  if (states.every((s) => s === "confirmed")) return "confirmed";
  if (states.includes("cancelled") && !states.every((s) => s === "cancelled")) return "pending";
  return states[0] ?? "pending";
}

export const STATUS_RANK: Record<string, number> = {
  pending: 0,
  confirmed: 1,
  paid: 2,
  cancelled: 3,
};

export function canTransition(from: string, to: string): boolean {
  if (from === to) return true;
  if (to === "cancelled") return true;
  if (from === "pending" && (to === "confirmed" || to === "paid")) return true;
  if (from === "confirmed" && to === "paid") return true;
  return false;
}

export function commissionGroupKey(commission: Commission): string {
  const supplied =
    (commission as { groupSubId?: unknown }).groupSubId ??
    (commission as { groupId?: unknown }).groupId ??
    (commission as { group?: unknown }).group ??
    (commission as { subId?: unknown }).subId ??
    (commission as { sub_id?: unknown }).sub_id;
  if (supplied !== undefined && supplied !== null && supplied !== "") return String(supplied).trim();

  const subIds = commission.subIds;
  if (subIds.length >= 3) return String(subIds[2]).trim();
  if (subIds.length === 1) return String(subIds[0]).trim();
  return "unknown";
}

export function normalizeConversion(node: ConversionReportNode, options?: { accountId?: unknown }): Commission {
  if (node === null || typeof node !== "object") throw new Error("invalid conversion node");

  const checkoutId = String(node.conversionId ?? "").trim();
  if (!checkoutId || checkoutId === "undefined" || checkoutId === "null") {
    throw new Error("conversion node missing conversionId");
  }

  const normalizedPurchaseTime = toSeconds(node.purchaseTime);
  if (normalizedPurchaseTime === undefined) {
    throw new Error("conversion node missing purchaseTime");
  }

  const subIds = asStringArray(
    (node as { subIds?: unknown }).subIds ??
      (node as { sub_ids?: unknown }).sub_ids ??
      (node as { subIdList?: unknown }).subIdList ??
      (node as { labels?: unknown }).labels,
  );
  if (subIds.length === 0 && typeof node.utmContent === "string" && node.utmContent.trim() !== "") {
    subIds.push(...parseUtmContent(node.utmContent));
  }
  if (subIds.length === 0 && node.subId !== undefined) subIds.push(String(node.subId).trim());
  if (subIds.length === 0 && node.sub_id !== undefined) subIds.push(String(node.sub_id).trim());
  if (subIds.length === 0 && node.group !== undefined) subIds.push(String(node.group).trim());
  if (subIds.length === 0 && node.groupId !== undefined) subIds.push(String(node.groupId).trim());

  // Estimated commission: accept number/string numeric, reject formatted money.
  const commissionRaw =
    node.totalCommission ?? node.estimatedCommission ?? node.commission ?? node.sellerCommission ?? node.shopeeCommissionCapped;
  const estimatedCommission = asNumber(commissionRaw);
  if (estimatedCommission < 0) throw new Error("estimatedCommission cannot be negative");

  const accountId =
    options?.accountId ??
    (node as { accountId?: unknown }).accountId ??
    (node as { account_id?: unknown }).account_id ??
    (node as { accountId?: unknown }).accountId;

  const status = mapShopeeStatus(
    node.status ?? node.orderStatus,
    Array.isArray(node.orders) ? node.orders : [],
  );

  return {
    checkoutId,
    accountId: accountId as Commission["accountId"],
    subIds,
    purchaseTime: normalizedPurchaseTime,
    estimatedCommission,
    status,
  };
}

export const toCommission = normalizeConversion;
export const mapConversionToCommission = normalizeConversion;
export const commissionFromConversion = normalizeConversion;
export const normalizeConversionNode = normalizeConversion;
export const normalizeNode = normalizeConversion;
export const fromConversionReportNode = normalizeConversion;
export const conversionToCommission = normalizeConversion;
export const makeCommission = normalizeConversion;
export const normalize = normalizeConversion;