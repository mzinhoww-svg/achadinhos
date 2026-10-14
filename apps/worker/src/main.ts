import { loadConfig, ConfigError, type WorkerConfig } from "./config.js";
import { createLogger, type Logger } from "./logger.js";
import { createWorkerRuntime, type RuntimeDeps, type WorkerRuntime } from "./runtime.js";

export type BuildDeps = (config: WorkerConfig, log: Logger) => Promise<Omit<RuntimeDeps, "config" | "log">>;

/**
 * Adaptadores de produção (SchedulerStore/claim_next_send/Vault sobre Postgres) ainda não existem:
 * falhar fechado é melhor do que subir um worker com portas em memória.
 */
export const defaultBuildDeps: BuildDeps = async () => {
  throw new Error("adaptador de produção ausente: falta o adaptador SQL do worker (Postgres/Vault)");
};

export type StartResult =
  | { ok: true; runtime: WorkerRuntime; config: WorkerConfig; log: Logger }
  | { ok: false; code: 1 };

export async function startWorker(opts: {
  env: Record<string, string | undefined>;
  buildDeps?: BuildDeps;
  sink?: (line: string) => void;
}): Promise<StartResult> {
  const sink = opts.sink ?? ((l: string) => process.stdout.write(`${l}\n`));
  let config: WorkerConfig;
  try {
    config = loadConfig(opts.env);
  } catch (e) {
    const log = createLogger({ sink });
    log.error("worker.config_invalida", e instanceof ConfigError ? { vars: [...e.vars] } : {});
    return { ok: false, code: 1 };
  }
  const log = createLogger({ sink, level: config.logLevel });
  // o segredo mais sensível do processo é registrado antes de qualquer outra coisa
  log.addSecret(config.databaseUrl.reveal());
  try {
    const parts = await (opts.buildDeps ?? defaultBuildDeps)(config, log);
    const runtime = createWorkerRuntime({
      config: {
        tickIntervalMs: config.tickIntervalMs,
        executorPollMs: config.executorPollMs,
        stallAlertMs: config.stallAlertMs,
        shutdownGraceMs: config.shutdownGraceMs,
        heartbeatStaleMs: config.heartbeatStaleMs,
      },
      log,
      ...parts,
    });
    runtime.start();
    log.info("worker.iniciado", { tickIntervalMs: config.tickIntervalMs });
    return { ok: true, runtime, config, log };
  } catch (e) {
    log.error("worker.falha_ao_iniciar", { err: e });
    return { ok: false, code: 1 };
  }
}

/** Processo: SIGTERM/SIGINT encerram limpo; segundo sinal força a saída. */
export async function main(): Promise<void> {
  const r = await startWorker({ env: process.env });
  if (!r.ok) {
    process.exitCode = r.code;
    return;
  }
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) process.exit(1);
    shuttingDown = true;
    r.log.info("worker.encerrando", { signal });
    const { clean } = await r.runtime.stop();
    r.log.info("worker.encerrado", { clean });
    process.exit(clean ? 0 : 1);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}
