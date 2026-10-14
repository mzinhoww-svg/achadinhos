import { advanceNextRunAt, isWithinWindow, resolveWindow, _calculateNextRunAtStrict } from "@achadinhos/domain";
import type { AutomationRow, DueGroup, OfferSelector, SchedulerStore, SelectionResult } from "./ports.js";

export const DEFAULT_DEDUPE_DAYS = 7;
const DEFAULT_LIMIT = 200;
const DAY_MS = 86_400_000;

export type SchedulerTickDeps = {
  store: SchedulerStore;
  /** Relógio injetável (produção: relógio do banco ou Date.now). */
  now: () => Date;
  selectOffer: OfferSelector;
  dedupeDays?: number;
  limit?: number;
  log?: (event: string, data: Record<string, unknown>) => void;
};

export type SchedulerTickResult = {
  considered: number;
  enqueued: number;
  skipped: number;
  advanced: number;
  initialized: number;
  contended: number;
  errors: number;
};

function windowConfig(a: AutomationRow) {
  return {
    days: a.days,
    windowStart: a.windowStart,
    windowEnd: a.windowEnd,
    frequencyMin: a.frequencyMin,
    timezone: a.timezone,
  };
}

/** Slot = next_run_at truncado à frequência, em UTC (decisão 001 A1). Determinístico entre workers. */
export function slotOf(nextRunAt: Date, frequencyMin: number): Date {
  const step = frequencyMin * 60_000;
  return new Date(Math.floor(nextRunAt.getTime() / step) * step);
}

export function idempotencyKey(automationId: string, groupId: string, slot: Date): string {
  return `${automationId}:${groupId}:${slot.toISOString()}`;
}

type Plan =
  | { kind: "init"; next: Date }
  | { kind: "advance"; next: Date }
  | { kind: "enqueue"; next: Date; slot: Date };

function plan(group: DueGroup, now: Date): Plan {
  const cfg = windowConfig(group.automation);
  if (group.nextRunAt === null) {
    return { kind: "init", next: _calculateNextRunAtStrict(now, cfg) };
  }
  const next = advanceNextRunAt({ next_run_at: group.nextRunAt }, cfg, now);
  // janela e dia avaliados no instante real do envio, no fuso da conta (A7/A8)
  if (!isWithinWindow(now, cfg)) return { kind: "advance", next };
  return { kind: "enqueue", next, slot: slotOf(group.nextRunAt, resolveWindow(cfg).freq) };
}

type Outcome = "enqueued" | "skipped" | "advanced" | "initialized" | "contended";

async function processGroup(deps: SchedulerTickDeps, candidate: DueGroup, now: Date): Promise<Outcome> {
  const { store } = deps;
  const p = plan(candidate, now);

  let selection: SelectionResult | null = null;
  let stacked = false;
  if (p.kind === "enqueue") {
    // pré-checagens e chamada externa FORA da transação: não segura lock durante rede
    stacked = await store.hasOpenSend(candidate.automationId, candidate.groupId);
    if (!stacked) {
      const days = deps.dedupeDays ?? DEFAULT_DEDUPE_DAYS;
      const history = await store.listRecentSends(candidate.groupId, new Date(now.getTime() - (days + 1) * DAY_MS));
      selection = await deps.selectOffer({
        accountId: candidate.accountId,
        automationId: candidate.automationId,
        groupId: candidate.groupId,
        filters: candidate.automation.filters,
        history,
        now,
        dedupeDays: days,
      });
    }
  }

  return store.transaction(async (tx) => {
    const locked = await tx.lockGroup(candidate.automationId, candidate.groupId, now);
    if (!locked) return "contended";
    if ((locked.nextRunAt?.getTime() ?? null) !== (candidate.nextRunAt?.getTime() ?? null)) return "contended";

    let outcome: Outcome = p.kind === "init" ? "initialized" : "advanced";
    if (p.kind === "enqueue" && !stacked && selection) {
      // revalida o empilhamento já com o lock da linha
      if (!(await tx.hasOpenSend(candidate.automationId, candidate.groupId))) {
        const key = idempotencyKey(candidate.automationId, candidate.groupId, p.slot);
        const offer = selection.kind === "offer" ? await tx.upsertOffer(candidate.accountId, selection.offer) : null;
        const inserted = await tx.insertSend({
          accountId: candidate.accountId,
          automationId: candidate.automationId,
          groupId: candidate.groupId,
          channelId: candidate.channelId,
          offerId: offer?.id ?? null,
          status: selection.kind === "offer" ? "queued" : "skipped",
          reason: selection.kind === "offer" ? null : selection.reason,
          idempotencyKey: key,
          scheduledFor: p.slot,
        });
        if (inserted) outcome = selection.kind === "offer" ? "enqueued" : "skipped";
      }
    }
    // mesma transação do insert (A9)
    await tx.setNextRunAt(candidate.automationId, candidate.groupId, p.next);
    return outcome;
  });
}

export async function runSchedulerTick(deps: SchedulerTickDeps): Promise<SchedulerTickResult> {
  const now = deps.now();
  const result: SchedulerTickResult = { considered: 0, enqueued: 0, skipped: 0, advanced: 0, initialized: 0, contended: 0, errors: 0 };
  const due = await deps.store.listDueGroups(now, deps.limit ?? DEFAULT_LIMIT);
  result.considered = due.length;

  for (const group of due) {
    try {
      const outcome = await processGroup(deps, group, now);
      result[outcome] += 1;
    } catch (error) {
      // isolamento por grupo: sem avançar, o mesmo slot (mesma chave) é tentado no próximo tick
      result.errors += 1;
      deps.log?.("scheduler.group_error", {
        automationId: group.automationId,
        groupId: group.groupId,
        // nunca error.message: erro de banco/Shopee pode carregar segredo
        errorName: error instanceof Error ? error.name : "desconhecido",
      });
    }
  }
  return result;
}
