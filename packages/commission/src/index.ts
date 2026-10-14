export * from "./types.js";
export * from "./normalizer.js";
export * from "./repository.js";
export * from "./collector.js";

import { InMemoryCommissionRepository } from "./repository.js";
import { CommissionCollector, createCommissionCollector, collectCommissions } from "./collector.js";
import { normalizeConversion, commissionGroupKey } from "./normalizer.js";

export const InMemoryCommissionStore = InMemoryCommissionRepository;
export const InMemoryCommissionRepo = InMemoryCommissionRepository;
export const InMemoryRepo = InMemoryCommissionRepository;
export const InMemoryRepository = InMemoryCommissionRepository;
export const MemoryCommissionRepository = InMemoryCommissionRepository;
export const MemoryRepository = InMemoryCommissionRepository;

export const Collector = CommissionCollector;
export const ConversionReportCollector = CommissionCollector;
export const ConversionCollector = CommissionCollector;
export const CommissionService = CommissionCollector;
export const CommissionSyncService = CommissionCollector;
export { CommissionCollector as CommissionCollectorService };

export function createCollector(...args: unknown[]): CommissionCollector {
  return createCommissionCollector(...args);
}
export function createCommissionSync(...args: unknown[]): CommissionCollector {
  return createCommissionCollector(...args);
}
export function createRepository(...args: unknown[]): InMemoryCommissionRepository {
  return new InMemoryCommissionRepository(args[0]);
}
export function createCommissionRepository(...args: unknown[]): InMemoryCommissionRepository {
  return new InMemoryCommissionRepository(args[0]);
}
export function createInMemoryRepository(...args: unknown[]): InMemoryCommissionRepository {
  return new InMemoryCommissionRepository(args[0]);
}
export function createInMemoryCommissionRepository(...args: unknown[]): InMemoryCommissionRepository {
  return new InMemoryCommissionRepository(args[0]);
}

export { commissionGroupKey as groupKey, commissionGroupKey as groupSubId, normalizeConversion as normalize };

export const Colllector = CommissionCollector;

export default {
  CommissionCollector,
  createCommissionCollector,
  collectCommissions,
  InMemoryCommissionRepository,
  normalizeConversion,
  commissionGroupKey,
};
export * from "./sql/sql-repository.js";
