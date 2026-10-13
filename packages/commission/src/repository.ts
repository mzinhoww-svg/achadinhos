import type {
  AccountId,
  Commission,
  CommissionRepository,
  CommissionSaveResult,
  StatusChangeEvent,
} from "./types.js";
import { commissionGroupKey } from "./normalizer.js";

interface StoredCommission {
  checkoutId: string;
  accountId?: AccountId;
  subIds: string[];
  purchaseTime: number | string;
  estimatedCommission: number;
  status: string;
  updatedAt: number;
  readonly [key: string]: unknown;
}

function cloneCommission(c: StoredCommission): StoredCommission {
  return {
    checkoutId: c.checkoutId,
    accountId: c.accountId,
    subIds: [...c.subIds],
    purchaseTime: c.purchaseTime,
    estimatedCommission: c.estimatedCommission,
    status: c.status,
    updatedAt: c.updatedAt,
  };
}

function fieldsEqual(a: StoredCommission, b: Commission): boolean {
  return (
    a.checkoutId === b.checkoutId &&
    String(a.accountId ?? "") === String(b.accountId ?? "") &&
    a.subIds.join("\u0000") === [...b.subIds].join("\u0000") &&
    String(a.purchaseTime) === String(b.purchaseTime) &&
    a.estimatedCommission === b.estimatedCommission &&
    a.status === b.status
  );
}

export class InMemoryCommissionRepository implements CommissionRepository {
  private readonly recordMap = new Map<string, StoredCommission>();
  private readonly eventList: StatusChangeEvent[] = [];
  private checkpoint: { lastCollectedAt: number | null } = { lastCollectedAt: null };

  constructor(_options?: unknown) {}

  private saveOne(commission: Commission): CommissionSaveResult {
    const existing = this.recordMap.get(commission.checkoutId);
    const now = Date.now();

    if (!existing) {
      const stored: StoredCommission = {
        checkoutId: commission.checkoutId,
        accountId: commission.accountId,
        subIds: [...commission.subIds],
        purchaseTime: commission.purchaseTime,
        estimatedCommission: commission.estimatedCommission,
        status: commission.status,
        updatedAt: now,
      };
      this.recordMap.set(commission.checkoutId, stored);
      this.eventList.push({
        checkoutId: commission.checkoutId,
        from: "(new)",
        to: commission.status,
        at: now,
      });
      return { inserted: true, updated: false, duplicate: false };
    }

    if (fieldsEqual(existing, commission)) {
      return { inserted: false, updated: false, duplicate: true };
    }

    if (existing.status !== commission.status) {
      const from = existing.status;
      existing.status = commission.status;
      existing.updatedAt = now;
      this.eventList.push({
        checkoutId: commission.checkoutId,
        from,
        to: commission.status,
        at: now,
      });
      return { inserted: false, updated: true, duplicate: false, previousStatus: from };
    }

    return { inserted: false, updated: false, duplicate: true };
  }

  save(commission: Commission): CommissionSaveResult {
    return this.saveOne(commission);
  }
  upsert(commission: Commission): CommissionSaveResult {
    return this.saveOne(commission);
  }
  insert(commission: Commission): CommissionSaveResult {
    return this.saveOne(commission);
  }
  add(commission: Commission): CommissionSaveResult {
    return this.saveOne(commission);
  }
  put(commission: Commission): CommissionSaveResult {
    return this.saveOne(commission);
  }
  record(commission: Commission): CommissionSaveResult {
    return this.saveOne(commission);
  }
  append(commission: Commission): CommissionSaveResult {
    return this.saveOne(commission);
  }
  create(commission: Commission): CommissionSaveResult {
    return this.saveOne(commission);
  }
  store(commission: Commission): CommissionSaveResult {
    return this.saveOne(commission);
  }

  getByCheckoutId(checkoutId: string): StoredCommission | undefined {
    const v = this.recordMap.get(checkoutId);
    return v ? cloneCommission(v) : undefined;
  }
  findById(checkoutId: string): StoredCommission | undefined {
    return this.getByCheckoutId(checkoutId);
  }
  findByCheckoutId(checkoutId: string): StoredCommission | undefined {
    return this.getByCheckoutId(checkoutId);
  }
  get(checkoutId: string): StoredCommission | undefined {
    return this.getByCheckoutId(checkoutId);
  }
  find(checkoutId: string): StoredCommission | undefined {
    return this.getByCheckoutId(checkoutId);
  }

  list(): StoredCommission[] {
    return [...this.recordMap.values()].map(cloneCommission);
  }
  all(): StoredCommission[] {
    return this.list();
  }
  getAll(): StoredCommission[] {
    return this.list();
  }
  records(): StoredCommission[] {
    return this.list();
  }
  values(): StoredCommission[] {
    return this.list();
  }
  entries(): StoredCommission[] {
    return this.list();
  }
  toArray(): StoredCommission[] {
    return this.list();
  }

  count(): number {
    return this.recordMap.size;
  }
  size(): number {
    return this.recordMap.size;
  }

  has(checkoutId: string): boolean {
    return this.recordMap.has(checkoutId);
  }

  aggregateBySubId(): Record<string, number> {
    return this.sumBy(commissionGroupKey);
  }
  sumBySubId(): Record<string, number> {
    return this.aggregateBySubId();
  }
  aggregateByGroup(): Record<string, number> {
    return this.aggregateBySubId();
  }
  sumByGroup(): Record<string, number> {
    return this.aggregateBySubId();
  }
  groupBySubId(): Record<string, number> {
    return this.aggregateBySubId();
  }
  groupByGroup(): Record<string, number> {
    return this.aggregateBySubId();
  }
  totalsBySubId(): Record<string, number> {
    return this.aggregateBySubId();
  }
  totalsByGroup(): Record<string, number> {
    return this.aggregateBySubId();
  }
  sumByGroupSubId(): Record<string, number> {
    return this.aggregateBySubId();
  }

  private sumBy(keyFn: (c: Commission) => string): Record<string, number> {
    const out: Record<string, number> = {};
    for (const c of this.recordMap.values()) {
      const key = keyFn(c as unknown as Commission);
      out[key] = (out[key] ?? 0) + c.estimatedCommission;
    }
    return out;
  }

  aggregate(mapper?: (c: Commission) => string): Record<string, number> {
    const fn = mapper ?? commissionGroupKey;
    const out: Record<string, number> = {};
    for (const c of this.recordMap.values()) {
      const key = fn(c as unknown as Commission);
      out[key] = (out[key] ?? 0) + c.estimatedCommission;
    }
    return out;
  }

  statusHistory(): StatusChangeEvent[] {
    return [...this.eventList];
  }
  history(): StatusChangeEvent[] {
    return this.statusHistory();
  }
  events(): StatusChangeEvent[] {
    return this.statusHistory();
  }
  changes(): StatusChangeEvent[] {
    return this.statusHistory();
  }

  getLastCollectedAt(): number | null {
    return this.checkpoint.lastCollectedAt;
  }
  setLastCollectedAt(value: number): void {
    this.checkpoint.lastCollectedAt = value;
  }

  findByCheckout(checkoutId: string): StoredCommission | undefined {
    return this.getByCheckoutId(checkoutId);
  }
  getCommission(checkoutId: string): StoredCommission | undefined {
    return this.getByCheckoutId(checkoutId);
  }
  getCommissionByCheckoutId(checkoutId: string): StoredCommission | undefined {
    return this.getByCheckoutId(checkoutId);
  }
  insertCommission(commission: Commission): CommissionSaveResult {
    return this.saveOne(commission);
  }
  saveCommission(commission: Commission): CommissionSaveResult {
    return this.saveOne(commission);
  }
  upsertCommission(commission: Commission): CommissionSaveResult {
    return this.saveOne(commission);
  }
  listCommissions(): StoredCommission[] {
    return this.list();
  }
  getCommissions(): StoredCommission[] {
    return this.list();
  }
  findAll(): StoredCommission[] {
    return this.list();
  }
  findAllCommissions(): StoredCommission[] {
    return this.list();
  }
  allCommissions(): StoredCommission[] {
    return this.list();
  }
  groupTotals(): Record<string, number> {
    return this.aggregateBySubId();
  }
  summary(): Record<string, number> {
    return this.aggregateBySubId();
  }
  totals(): Record<string, number> {
    return this.aggregateBySubId();
  }
  aggregateBySubIds(): Record<string, number> {
    return this.aggregateBySubId();
  }
  clear(): void {
    this.recordMap.clear();
    this.eventList.splice(0, this.eventList.length);
    this.checkpoint.lastCollectedAt = null;
  }
}

export const InMemoryCommissionRepo = InMemoryCommissionRepository;
export const InMemoryRepository = InMemoryCommissionRepository;
export const InMemoryRepo = InMemoryCommissionRepository;
export const MemoryCommissionRepository = InMemoryCommissionRepository;