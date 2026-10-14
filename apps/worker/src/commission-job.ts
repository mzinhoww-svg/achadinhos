import { createCommissionCollector } from "@achadinhos/commission";
import type { CollectResult, CommissionRepository, ConversionSource } from "@achadinhos/commission";
import { withDeadline } from "./deadline.js";
import type { Logger } from "./logger.js";

/** Item 12: coleta do conversionReport a cada 6 h. */
export const COMMISSION_JOB_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** Teto total da coleta de UMA conta (todas as páginas); o cliente Shopee ainda aplica o seu próprio por chamada. */
export const COMMISSION_ACCOUNT_TIMEOUT_MS = 5 * 60 * 1000;

export interface CommissionJobPorts {
  listAccounts(): Promise<readonly string[]>;
  /** Cliente Shopee da conta (`ShopeeClient` satisfaz a porta via `conversionReport`). */
  sourceFor(accountId: string): ConversionSource;
  /** Repositório da conta (SQL em produção; memória em teste). */
  repositoryFor(accountId: string): CommissionRepository;
}

export interface CommissionJobOptions {
  logger: Logger;
  /** Relógio em segundos Unix (UTC) usado como fim da janela. */
  now?: () => number;
  intervalMs?: number;
  accountTimeoutMs?: number;
}

export interface CommissionCycleResult {
  accounts: number;
  succeeded: number;
  failed: number;
  listFailed: boolean;
  results: Array<{ accountId: string; result: CollectResult }>;
}

function errorName(e: unknown): string {
  return e instanceof Error ? e.name : "UnknownError";
}

/** Um ciclo: contas em sequência, falha isolada por conta, log só com o nome do erro. */
export async function runCommissionCycle(
  ports: CommissionJobPorts,
  options: CommissionJobOptions,
): Promise<CommissionCycleResult> {
  const { logger } = options;
  const nowSeconds = options.now ?? (() => Math.floor(Date.now() / 1000));
  const timeoutMs = options.accountTimeoutMs ?? COMMISSION_ACCOUNT_TIMEOUT_MS;
  const out: CommissionCycleResult = { accounts: 0, succeeded: 0, failed: 0, listFailed: false, results: [] };

  let accounts: readonly string[];
  try {
    accounts = await ports.listAccounts();
  } catch (e) {
    out.listFailed = true;
    logger.error("commission_job_list_accounts_failed", { errorName: errorName(e) });
    return out;
  }
  out.accounts = accounts.length;

  for (const accountId of accounts) {
    try {
      const collector = createCommissionCollector({
        source: ports.sourceFor(accountId),
        repository: ports.repositoryFor(accountId),
        accountId,
        now: nowSeconds,
      });
      const result = await withDeadline(collector.collect(), timeoutMs, "commission_collect");
      out.succeeded += 1;
      out.results.push({ accountId, result });
      logger.info("commission_collected", {
        accountId,
        inserted: result.inserted,
        updated: result.updated,
        skipped: result.skipped,
        pages: result.pages,
      });
    } catch (e) {
      out.failed += 1;
      logger.error("commission_collect_failed", { accountId, errorName: errorName(e) });
    }
  }
  return out;
}

export interface CommissionJob {
  /** Para o agendamento; aguarda o ciclo em curso terminar. */
  stop(): Promise<void>;
}

/** Roda ao iniciar e depois a cada `intervalMs` após o término do ciclo anterior (nunca sobrepõe). */
export function startCommissionJob(ports: CommissionJobPorts, options: CommissionJobOptions): CommissionJob {
  const intervalMs = options.intervalMs ?? COMMISSION_JOB_INTERVAL_MS;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> = Promise.resolve();

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(tick, intervalMs);
  };
  const tick = () => {
    running = runCommissionCycle(ports, options)
      .then(() => undefined)
      .catch((e: unknown) => {
        options.logger.error("commission_job_cycle_failed", { errorName: errorName(e) });
      })
      .finally(schedule);
  };
  tick();

  return {
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await running;
    },
  };
}
