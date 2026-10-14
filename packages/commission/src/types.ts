export type AccountId = string | number | null | undefined;

export type NumericLike = number | string;

export interface ConversionReportNode {
  readonly purchaseTime: number;
  readonly clickTime?: number;
  readonly conversionId: NumericLike;
  readonly totalCommission?: NumericLike;
  readonly estimatedCommission?: NumericLike;
  readonly commission?: NumericLike;
  readonly sellerCommission?: NumericLike;
  readonly shopeeCommissionCapped?: NumericLike;
  readonly buyerType?: string;
  readonly device?: string;
  readonly utmContent?: string;
  readonly subIds?: readonly (string | number)[];
  readonly subId?: NumericLike;
  readonly sub_id?: NumericLike;
  readonly groupSubId?: NumericLike;
  readonly group?: NumericLike;
  readonly groupId?: NumericLike;
  readonly status?: string;
  readonly orderStatus?: string;
  readonly orders?: readonly unknown[];
  readonly [key: string]: unknown;
}

export interface ConversionReportPage {
  readonly nodes: readonly ConversionReportNode[];
  readonly pageInfo: {
    readonly hasNextPage: boolean;
    readonly scrollId: string;
    readonly limit?: number;
  };
}

export interface Commission {
  readonly checkoutId: string;
  readonly accountId?: AccountId;
  readonly subIds: readonly string[];
  readonly purchaseTime: number | string;
  readonly estimatedCommission: number;
  readonly status: string;
  readonly updatedAt?: number;
  readonly [key: string]: unknown;
}

export interface CommissionSaveResult {
  readonly inserted: boolean;
  readonly updated: boolean;
  readonly duplicate: boolean;
  readonly previousStatus?: string;
}

export interface StatusChangeEvent {
  readonly checkoutId: string;
  readonly from: string;
  readonly to: string;
  readonly at: number;
}

export interface CollectOptions {
  readonly purchaseTimeStart?: number;
  readonly purchaseTimeEnd?: number;
  readonly limit?: number;
  readonly pageSize?: number;
  readonly overlapSeconds?: number;
  readonly lookbackSeconds?: number;
  readonly now?: () => number;
  readonly maxPages?: number;
  readonly accountId?: unknown;
}

export interface CollectResult {
  readonly inserted: number;
  readonly updated: number;
  readonly skipped: number;
  readonly total: number;
  readonly pages: number;
  readonly collectedAt: number;
}

export interface ConversionSource {
  conversionReport?(params?: CollectOptions & { scrollId?: string }): Promise<ConversionReportPage> | ConversionReportPage;
  fetchConversionReport?(params?: CollectOptions & { scrollId?: string }): Promise<ConversionReportPage> | ConversionReportPage;
  fetch?(params?: CollectOptions & { scrollId?: string }): Promise<ConversionReportPage> | ConversionReportPage;
  getConversionReport?(params?: CollectOptions & { scrollId?: string }): Promise<ConversionReportPage> | ConversionReportPage;
  list?(params?: CollectOptions & { scrollId?: string }): Promise<ConversionReportPage> | ConversionReportPage;
}

export type ConversionSourcePort = ConversionSource;

export interface CommissionRepository {
  save(commission: Commission): CommissionSaveResult | Promise<CommissionSaveResult>;
  upsert(commission: Commission): CommissionSaveResult | Promise<CommissionSaveResult>;
  insert(commission: Commission): CommissionSaveResult | Promise<CommissionSaveResult>;
  add(commission: Commission): CommissionSaveResult | Promise<CommissionSaveResult>;
  put(commission: Commission): CommissionSaveResult | Promise<CommissionSaveResult>;
  record(commission: Commission): CommissionSaveResult | Promise<CommissionSaveResult>;
  getByCheckoutId(checkoutId: string): Commission | undefined | Promise<Commission | undefined>;
  findById(checkoutId: string): Commission | undefined | Promise<Commission | undefined>;
  findByCheckoutId(checkoutId: string): Commission | undefined | Promise<Commission | undefined>;
  list(): readonly Commission[] | Commission[];
  all(): readonly Commission[] | Commission[];
  getAll(): readonly Commission[] | Commission[];
  records(): readonly Commission[] | Commission[];
  aggregateBySubId?(): Record<string, number>;
  sumBySubId?(): Record<string, number>;
  sumByGroup?(): Record<string, number>;
  aggregateByGroup?(): Record<string, number>;
  groupBySubId?(): Record<string, number>;
  groupByGroup?(): Record<string, number>;
  totalsBySubId?(): Record<string, number>;
  totalsByGroup?(): Record<string, number>;
  statusHistory?(): readonly StatusChangeEvent[];
  history?(): readonly StatusChangeEvent[];
  getLastCollectedAt?(): number | undefined | null;
  setLastCollectedAt?(value: number): void;
}

export interface CommissionRepositoryPort extends CommissionRepository {}
