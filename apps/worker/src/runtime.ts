import type { ClaimedSend, RunOutcome } from "./executor.js";
import { createHeartbeat, type Heartbeat, type HeartbeatStatus } from "./heartbeat.js";
import type { Logger } from "./logger.js";
import type { SchedulerTickResult } from "./scheduler.js";

/** Alertas que o worker dispara (packages/alerts: AlertService satisfaz esta forma). */
export interface AlertSink {
  shopeeCredentialFailed(ctx: { accountId: string; reason: string }): Promise<unknown>;
  telegramBotLostAccess(ctx: { accountId: string; group: string; reason: string }): Promise<unknown>;
  workerNoHeartbeat(lastHeartbeatAt?: Date): Promise<unknown>;
}

/**
 * Sinal da validação rápida de credenciais (T7-08, PR #28). Porta: o laço real entra
 * com o #28; aqui só se consome o que ele reporta.
 */
export type ValidationSignal =
  | { kind: "shopee_credential_invalid"; accountId: string }
  | { kind: "telegram_no_access"; accountId: string; group: string };

export interface RuntimeDeps {
  config: {
    tickIntervalMs: number;
    executorPollMs: number;
    stallAlertMs: number;
    shutdownGraceMs: number;
    heartbeatStaleMs?: number;
  };
  log: Logger;
  /** Relógio do banco (nunca confiar no do processo para regra de negócio). */
  now: () => Date;
  scheduler: { runTick(): Promise<SchedulerTickResult> };
  queue: {
    listChannels(): Promise<string[]>;
    /** Envolve `claim_next_send(channel)` e monta o envio com oferta/chat/handle. */
    claim(channelId: string): Promise<ClaimedSend | null>;
  };
  executor: { run(send: ClaimedSend): Promise<RunOutcome> };
  alerts: AlertSink;
  validation?: { runOnce(): Promise<ValidationSignal[]> };
  /** Batimento persistido (tabela), legível pelo monitor externo. */
  heartbeatStore?: { write(at: Date): Promise<void>; read(): Promise<Date | null> };
}

const TELEGRAM_ACCESS_REASONS = new Set([
  "telegram_sem_acesso",
  "telegram_bot_removido",
  "telegram_bot_bloqueado",
  "telegram_chat_nao_encontrado",
]);

export interface WorkerRuntime {
  tickOnce(): Promise<void>;
  executorOnce(): Promise<void>;
  validateOnce(): Promise<void>;
  checkStalled(): Promise<boolean>;
  heartbeat(): HeartbeatStatus;
  start(): void;
  stop(): Promise<{ clean: boolean }>;
}

/** Verificação do monitor externo: lê o batimento persistido e alerta se passou do limite. */
export async function checkWorkerStalled(
  store: { read(): Promise<Date | null> },
  alerts: Pick<AlertSink, "workerNoHeartbeat">,
  now: Date,
  stallAlertMs: number,
): Promise<boolean> {
  const last = await store.read();
  const stale = last === null || now.getTime() - last.getTime() > stallAlertMs;
  if (stale) await alerts.workerNoHeartbeat(last ?? undefined);
  return stale;
}

export function createWorkerRuntime(deps: RuntimeDeps): WorkerRuntime {
  const { config, log, alerts } = deps;
  const nowMs = () => deps.now().getTime();
  const hb: Heartbeat = createHeartbeat({ now: nowMs, staleAfterMs: config.heartbeatStaleMs ?? 180_000 });
  const startedAt = deps.now();
  const inflight = new Set<Promise<unknown>>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let started = false;
  let stopped = false;

  /** Falha de alerta nunca derruba o laço; só nomes/códigos vão para o log. */
  const sendAlert = async (what: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      log.warn("worker.alert_failed", { what, errorName: e instanceof Error ? e.name : "desconhecido" });
    }
  };

  async function tickOnce(): Promise<void> {
    try {
      const result = await deps.scheduler.runTick();
      hb.beat();
      log.info("worker.tick", { ...result });
      if (deps.heartbeatStore) {
        try {
          await deps.heartbeatStore.write(deps.now());
        } catch (e) {
          log.warn("worker.heartbeat_write_failed", { errorName: e instanceof Error ? e.name : "desconhecido" });
        }
      }
    } catch (e) {
      // nunca error.message: pode carregar segredo
      log.error("worker.tick_failed", { errorName: e instanceof Error ? e.name : "desconhecido" });
    }
  }

  async function handleOutcome(send: ClaimedSend, outcome: RunOutcome): Promise<void> {
    log.info("worker.send_finished", {
      sendId: send.sendId, status: outcome.status, reason: outcome.reason,
      finishRecorded: outcome.finishRecorded, leaseLost: outcome.leaseLost,
    });
    const reason = outcome.reason;
    if (outcome.status !== "failed" || !reason) return;
    if (TELEGRAM_ACCESS_REASONS.has(reason)) {
      await sendAlert("telegram", () => alerts.telegramBotLostAccess({ accountId: send.accountId, group: send.groupId, reason }));
    } else if (reason === "shopee_assinatura_invalida") {
      await sendAlert("shopee", () => alerts.shopeeCredentialFailed({ accountId: send.accountId, reason }));
    }
  }

  async function runChannel(channelId: string): Promise<void> {
    try {
      const send = await deps.queue.claim(channelId);
      if (!send) return;
      await handleOutcome(send, await deps.executor.run(send));
    } catch (e) {
      log.error("worker.channel_failed", { channelId, errorName: e instanceof Error ? e.name : "desconhecido" });
    }
  }

  async function executorOnce(): Promise<void> {
    let channels: string[];
    try {
      channels = await deps.queue.listChannels();
    } catch (e) {
      log.error("worker.list_channels_failed", { errorName: e instanceof Error ? e.name : "desconhecido" });
      return;
    }
    await Promise.allSettled(channels.map(runChannel));
  }

  async function validateOnce(): Promise<void> {
    if (!deps.validation) return;
    let signals: ValidationSignal[];
    try {
      signals = await deps.validation.runOnce();
    } catch (e) {
      log.error("worker.validation_failed", { errorName: e instanceof Error ? e.name : "desconhecido" });
      return;
    }
    for (const s of signals) {
      if (s.kind === "shopee_credential_invalid") {
        await sendAlert("shopee", () => alerts.shopeeCredentialFailed({ accountId: s.accountId, reason: "credencial_invalida" }));
      } else {
        await sendAlert("telegram", () => alerts.telegramBotLostAccess({ accountId: s.accountId, group: s.group, reason: "sem_acesso" }));
      }
    }
  }

  async function checkStalled(): Promise<boolean> {
    const lastMs = hb.status().lastBeatAt;
    let last: Date = lastMs === null ? startedAt : new Date(lastMs);
    if (lastMs === null && deps.heartbeatStore) {
      try {
        const persisted = await deps.heartbeatStore.read();
        if (persisted && persisted > last) last = persisted;
      } catch {
        /* usa o início do processo */
      }
    }
    const stale = nowMs() - last.getTime() > config.stallAlertMs;
    if (stale) await sendAlert("heartbeat", () => alerts.workerNoHeartbeat(last));
    return stale;
  }

  /** Laço sem sobreposição: a próxima execução só é agendada quando a anterior termina. */
  function loop(name: string, fn: () => Promise<unknown>, everyMs: number): void {
    const run = async () => {
      if (stopped) return;
      const p = fn().catch((e) => log.error("worker.loop_failed", { loop: name, errorName: e instanceof Error ? e.name : "desconhecido" }));
      inflight.add(p);
      await p;
      inflight.delete(p);
      if (stopped) return;
      const t = setTimeout(run, everyMs);
      t.unref?.();
      timers.add(t);
    };
    void run();
  }

  return {
    tickOnce,
    executorOnce,
    validateOnce,
    checkStalled,
    heartbeat: () => hb.status(),
    start() {
      if (started) return;
      started = true;
      loop("tick", tickOnce, config.tickIntervalMs);
      loop("executor", executorOnce, config.executorPollMs);
      if (deps.validation) loop("validation", validateOnce, config.executorPollMs);
      loop("stalled", checkStalled, Math.min(60_000, Math.max(1_000, Math.floor(config.stallAlertMs / 10))));
    },
    async stop() {
      stopped = true;
      for (const t of timers) clearTimeout(t);
      timers.clear();
      const pending = Promise.allSettled([...inflight]).then(() => true);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const grace = new Promise<boolean>((r) => {
        timer = setTimeout(() => r(false), config.shutdownGraceMs);
      });
      const clean = await Promise.race([pending, grace]);
      clearTimeout(timer);
      return { clean };
    },
  };
}
