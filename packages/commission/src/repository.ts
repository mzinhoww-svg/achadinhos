import type {
  AccountId,
  Commission,
  CommissionRepository,
  CommissionSaveResult,
  StatusChangeEvent,
} from "./types.js";
import { commissionGroupKey, canTransition } from "./normalizer.js";

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

export class InMemoryCommissionRepository implements CommissionRepository {
  private readonly recordMap = new Map<string, StoredCommission>();
  private readonly eventList: StatusChangeEvent[] = [];
  private checkpoint: { lastCollectedAt: number | null } = { lastCollectedAt: null };

  constructor(_options?: unknown) {}

  private storageKey(commission: Commission): string {
    return `${String(commission.accountId ?? "")}:${commission.checkoutId}`;
  }

  private findStorageKey(checkoutId: string, accountId?: unknown): string | undefined {
    const direct = `${String(accountId ?? "")}:${checkoutId}`;
    if (this.recordMap.has(direct)) return direct;
    for (const [key, value] of this.recordMap.entries()) {
      if (value.checkoutId === checkoutId) return key;
    }
    return undefined;
  }

  private saveOne(commission: Commission): CommissionSaveResult {
    const accountId = commission.accountId;
    const key = this.storageKey(commission);
    const existingKey = this.recordMap.has(key) ? key : this.findStorageKey(commission.checkoutId, accountId);
    const existing = existingKey ? this.recordMap.get(existingKey) : undefined;
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
      this.recordMap.set(key, stored);
      this.eventList.push({
        checkoutId: commission.checkoutId,
        from: "(new)",
        to: commission.status,
        at: now,
      });
      return { inserted: true, updated: false, duplicate: false };
    }

    let changed = false;

    // Status monotônico: não reverte estado mais avançado com dado antigo.
    let previousStatus: string | undefined;
    if (existing.status !== commission.status && canTransition(existing.status, commission.status)) {
      previousStatus = existing.status;
      existing.status = commission.status;
      changed = true;
      this.eventList.push({
        checkoutId: commission.checkoutId,
        from: previousStatus,
        to: commission.status,
        at: now,
      });
    }

    if (existing.estimatedCommission !== commission.estimatedCommission) {
      existing.estimatedCommission = commission.estimatedCommission;
      changed = true;
    }
    if (existing.subIds.join("\u0000") !== [...commission.subIds].join("\u0000")) {
      existing.subIds = [...commission.subIds];
      changed = true;
    }
    if (String(existing.purchaseTime) !== String(commission.purchaseTime)) {
      existing.purchaseTime = commission.purchaseTime;
      changed = true;
    }
    if (accountId !== undefined && existing.accountId !== accountId) {
      existing.accountId = accountId;
      changed = true;
    }

    const resultPreviousStatus = previousStatus;
    if (changed) {
      existing.updatedAt = now;
      if (existingKey !== key && existingKey) {
        this.recordMap.delete(existingKey);
        this.recordMap.set(key, existing);
      }
      if (resultPreviousStatus !== undefined) {
        return { inserted: false, updated: true, duplicate: false, previousStatus: resultPreviousStatus };
      }
      return { inserted: false, updated: true, duplicate: false };
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
    const key = this.findStorageKey(checkoutId, undefined);
    const v = key ? this.recordMap.get(key) : undefined;
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
    return this.findStorageKey(checkoutId) !== undefined;
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