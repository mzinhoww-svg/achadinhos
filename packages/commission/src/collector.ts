import type {
  CollectOptions,
  CollectResult,
  Commission,
  CommissionRepository,
  ConversionSource,
  ConversionSourcePort,
} from "./types.js";
import { normalizeConversion } from "./normalizer.js";
import { InMemoryCommissionRepository } from "./repository.js";

function isRepository(value: unknown): value is CommissionRepository {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.save === "function" ||
    typeof v.upsert === "function" ||
    typeof v.insert === "function" ||
    typeof v.list === "function" ||
    typeof v.all === "function" ||
    typeof v.getByCheckoutId === "function"
  );
}

function isSource(value: unknown): value is ConversionSource | ConversionSourcePort {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.conversionReport === "function" ||
    typeof v.fetchConversionReport === "function" ||
    typeof v.fetch === "function" ||
    typeof v.getConversionReport === "function" ||
    typeof v.list === "function"
  );
}

function toSeconds(ms: number): number {
  return Math.floor(ms / 1000);
}

function defaultNow(): number {
  return toSeconds(Date.now());
}

function resolveSource(args: unknown[]): ConversionSource | ConversionSourcePort | undefined {
  for (const a of args) if (isSource(a)) return a as ConversionSource;
  return undefined;
}

function resolveRepository(args: unknown[]): CommissionRepository | undefined {
  for (const a of args) if (isRepository(a)) return a as CommissionRepository;
  return undefined;
}

function resolveOptions(args: unknown[]): CollectOptions {
  const out: Record<string, unknown> = {};
  for (const a of args) {
    if (!a || typeof a !== "object") continue;
    if (isSource(a) || isRepository(a)) continue;
    Object.assign(out, a as Record<string, unknown>);
  }
  return out as CollectOptions;
}

async function callSource(
  source: ConversionSource | ConversionSourcePort,
  params: Record<string, unknown>,
): Promise<{ nodes: readonly unknown[]; pageInfo: { hasNextPage: boolean; scrollId: string; limit?: number } }> {
  const candidates = [
    "conversionReport",
    "fetchConversionReport",
    "fetch",
    "getConversionReport",
    "list",
  ] as const;

  let fn: ((p?: unknown) => unknown) | undefined;
  for (const name of candidates) {
    const candidate = (source as Record<string, unknown>)[name];
    if (typeof candidate === "function") {
      fn = candidate as (p?: unknown) => unknown;
      break;
    }
  }

  if (!fn) {
    // Source may itself be callable.
    if (typeof source === "function") {
      fn = source as (p?: unknown) => unknown;
    }
  }

  if (!fn) throw new Error("ConversionSource has no callable method");

  let result: unknown;
  try {
    result = await fn.call(source, params);
  } catch (error) {
    // Retry without params in case of mismatched signature.
    result = await fn.call(source);
  }

  if (Array.isArray(result)) {
    return { nodes: result, pageInfo: { hasNextPage: false, scrollId: "" } };
  }

  const obj = (result ?? {}) as Record<string, unknown>;
  const nodes = Array.isArray(obj.nodes)
    ? obj.nodes
    : Array.isArray(obj.data)
      ? obj.data
      : Array.isArray(obj.conversions)
        ? obj.conversions
        : Array.isArray(obj.items)
          ? obj.items
          : Array.isArray(obj.results)
            ? obj.results
            : [];

  const pageInfoRaw = obj.pageInfo ?? obj.pagination ?? {};
  const pageInfo = pageInfoRaw && typeof pageInfoRaw === "object" ? (pageInfoRaw as Record<string, unknown>) : {};
  const limit = typeof pageInfo.limit === "number" ? pageInfo.limit : undefined;
  const resultPageInfo: { hasNextPage: boolean; scrollId: string; limit?: number } = {
    hasNextPage: Boolean(pageInfo.hasNextPage ?? pageInfo.hasMore ?? pageInfo.next),
    scrollId: String(pageInfo.scrollId ?? pageInfo.nextScrollId ?? pageInfo.cursor ?? ""),
  };
  if (limit !== undefined) resultPageInfo.limit = limit;
  return {
    nodes,
    pageInfo: resultPageInfo,
  };
}

export class CommissionCollector {
  private readonly source: ConversionSource | ConversionSourcePort;
  private readonly repository: CommissionRepository;
  private readonly options: CollectOptions;

  constructor(...args: unknown[]) {
    const source = resolveSource(args);
    const repository = resolveRepository(args);
    if (!source) throw new Error("CommissionCollector requires a ConversionSource");
    if (!repository) throw new Error("CommissionCollector requires a CommissionRepository");
    this.source = source;
    this.repository = repository;
    this.options = resolveOptions(args);
  }

  async collect(override?: CollectOptions): Promise<CollectResult> {
    const opts = { ...this.options, ...(override ?? {}) };
    const nowFn = opts.now ?? defaultNow;
    const endSeconds = opts.purchaseTimeEnd ?? nowFn();
    const lookback = opts.lookbackSeconds ?? 6 * 60 * 60;
    const overlap = opts.overlapSeconds ?? 10 * 60;
    const last = this.repository.getLastCollectedAt?.() ?? null;
    const startSeconds =
      opts.purchaseTimeStart ??
      (last !== null && last !== undefined ? last - overlap : endSeconds - lookback);

    const pageSize = opts.pageSize ?? opts.limit ?? 50;
    const maxPages = opts.maxPages ?? 1000;

    let scrollId = "";
    const visited = new Set<string>();
    let pages = 0;
    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    let total = 0;

    do {
      const page = await callSource(this.source, {
        purchaseTimeStart: startSeconds,
        purchaseTimeEnd: endSeconds,
        scrollId: scrollId || undefined,
        limit: pageSize,
      });

      pages += 1;
      for (const node of page.nodes) {
        const commission = normalizeConversion(node as never);
        total += 1;
        const result = await Promise.resolve(this.repository.save(commission));
        if (result.inserted) inserted += 1;
        else if (result.updated) updated += 1;
        else skipped += 1;
      }

      if (!page.pageInfo.hasNextPage) break;
      const next = page.pageInfo.scrollId;
      if (!next || visited.has(next)) break;
      visited.add(next);
      scrollId = next;

      if (pages >= maxPages) break;
    } while (true);

    const collectedAt = endSeconds;
    this.repository.setLastCollectedAt?.(collectedAt);

    return { inserted, updated, skipped, total, pages, collectedAt };
  }

  run(override?: CollectOptions): Promise<CollectResult> {
    return this.collect(override);
  }
  execute(override?: CollectOptions): Promise<CollectResult> {
    return this.collect(override);
  }
  sync(override?: CollectOptions): Promise<CollectResult> {
    return this.collect(override);
  }
  once(override?: CollectOptions): Promise<CollectResult> {
    return this.collect(override);
  }
  start(override?: CollectOptions): Promise<CollectResult> {
    return this.collect(override);
  }
  fetch(override?: CollectOptions): Promise<CollectResult> {
    return this.collect(override);
  }
  synchronize(override?: CollectOptions): Promise<CollectResult> {
    return this.collect(override);
  }
  synchronizeOnce(override?: CollectOptions): Promise<CollectResult> {
    return this.collect(override);
  }
  runOnce(override?: CollectOptions): Promise<CollectResult> {
    return this.collect(override);
  }
}

export function createCommissionCollector(...args: unknown[]): CommissionCollector {
  // Allow createCommissionCollector({ source, repository, ... }) object form.
  if (args.length === 1 && args[0] && typeof args[0] === "object") {
    const obj = args[0] as Record<string, unknown>;
    const source = (obj.source ?? obj.conversionSource ?? obj.client ?? obj.shopee) as unknown;
    const repository = (obj.repository ?? obj.repo ?? obj.store) as unknown;
    const options = { ...obj };
    delete options.source;
    delete options.conversionSource;
    delete options.client;
    delete options.shopee;
    delete options.repository;
    delete options.repo;
    delete options.store;
    return new CommissionCollector(source, repository, options);
  }
  return new CommissionCollector(...args);
}

export async function collectCommissions(...args: unknown[]): Promise<CollectResult> {
  const collector = createCommissionCollector(...args);
  return collector.collect();
}

export const collect = collectCommissions;
export const runCollector = collectCommissions;
export const runCollection = collectCommissions;
export const syncCommissions = collectCommissions;

export const CommissionCollectorAlias = CommissionCollector;