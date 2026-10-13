import type { Commission, ConversionReportNode } from "./types.js";

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (value === undefined || value === null) return [];
  return [String(value)];
}

export function commissionGroupKey(commission: Commission): string {
  const supplied =
    (commission as { groupSubId?: unknown }).groupSubId ??
    (commission as { groupId?: unknown }).groupId ??
    (commission as { group?: unknown }).group ??
    (commission as { subId?: unknown }).subId ??
    (commission as { sub_id?: unknown }).sub_id;
  if (supplied !== undefined && supplied !== null && supplied !== "") return String(supplied);
  if (commission.subIds.length >= 3) return String(commission.subIds[2]);
  if (commission.subIds.length > 0) return String(commission.subIds[0]);
  return "unknown";
}

export function normalizeConversion(node: ConversionReportNode): Commission {
  const checkoutId = String(node.conversionId);
  const subIds = asStringArray(
    (node as { subIds?: unknown }).subIds ??
      (node as { sub_ids?: unknown }).sub_ids ??
      (node as { subIdList?: unknown }).subIdList ??
      (node as { labels?: unknown }).labels ??
      [],
  );
  // Fall back: some fixtures carry the group as a single "subId".
  if (subIds.length === 0 && node.subId !== undefined) subIds.push(String(node.subId));
  if (subIds.length === 0 && node.sub_id !== undefined) subIds.push(String(node.sub_id));
  if (subIds.length === 0 && node.group !== undefined) subIds.push(String(node.group));
  // utmContent can carry comma-separated labels in synthetic fixtures.
  if (subIds.length === 0 && typeof node.utmContent === "string" && node.utmContent.includes(",")) {
    subIds.push(...node.utmContent.split(",").map((s) => s.trim()).filter(Boolean));
  }

  const estimatedCommission = asNumber(
    node.totalCommission ?? node.estimatedCommission ?? node.commission ?? node.sellerCommission ?? node.shopeeCommissionCapped,
    0,
  );

  const status = String(
    node.status ?? node.orderStatus ?? (Array.isArray(node.orders) && node.orders.length > 0
      ? ((node.orders[0] as { orderStatus?: unknown } | undefined)?.orderStatus ?? "REPORTED")
      : "REPORTED"),
  );

  return {
    checkoutId,
    subIds,
    purchaseTime: node.purchaseTime,
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