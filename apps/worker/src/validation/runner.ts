import { createShopeeClient } from "@achadinhos/shopee";
import type { ShopeeClient, ShopeeCredentials } from "@achadinhos/shopee";
import { TelegramClient } from "@achadinhos/telegram";

import type {
  Outcome,
  SecretVault,
  ValidationLogger,
  ValidationStore,
  ValidationTask,
} from "./types.js";
import {
  MESSAGES,
  validateShopee,
  validateTelegramGroup,
  validateTelegramToken,
} from "./validators.js";

export type ValidationDeps = {
  store: ValidationStore;
  vault: SecretVault;
  logger: ValidationLogger;
  now?: () => Date;
  /** Prazo total por tarefa (Vault + chamada externa + gravação). Menor que o ciclo de 15 s. */
  taskTimeoutMs?: number;
  /** Tentativas transitórias antes de marcar `invalid`. */
  maxAttempts?: number;
  batchSize?: number;
  createShopee?: (credentials: ShopeeCredentials) => ShopeeClient;
  createTelegram?: (token: string) => TelegramClient;
};

const DEFAULT_TASK_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BATCH = 10;

class TaskDeadline extends Error {}

function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new TaskDeadline("deadline")), ms);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

async function evaluate(task: ValidationTask, deps: ValidationDeps): Promise<Outcome> {
  const secret = await deps.vault.read(task.secretId);
  if (secret === null || secret === "") {
    return { status: "invalid", error: MESSAGES.secretMissing };
  }
  const createShopee = deps.createShopee ?? ((c) => createShopeeClient(c));
  const createTelegram = deps.createTelegram ?? ((token) => new TelegramClient({ token }));

  switch (task.kind) {
    case "shopee_credential":
      return validateShopee(createShopee({ appId: task.appId, secret }));
    case "telegram_channel":
      return validateTelegramToken(createTelegram(secret));
    case "telegram_group":
      return validateTelegramGroup(createTelegram(secret), task.externalId);
  }
}

async function processTask(task: ValidationTask, deps: ValidationDeps): Promise<void> {
  const now = deps.now ?? (() => new Date());
  const timeoutMs = deps.taskTimeoutMs ?? DEFAULT_TASK_TIMEOUT_MS;
  const maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  // Só id/tipo/resultado vão para o log; nada que venha do Vault ou da API externa.
  const ctx = { task: task.id, kind: task.kind };

  let outcome: Outcome;
  try {
    outcome = await withDeadline(evaluate(task, deps), timeoutMs);
  } catch {
    outcome = { status: "retry", error: MESSAGES.unavailable };
  }

  try {
    if (outcome.status === "validated") {
      await deps.store.markValidated(task, now());
      deps.logger.info("validation.validated", ctx);
    } else if (outcome.status === "invalid") {
      await deps.store.markInvalid(task, outcome.error, now());
      deps.logger.info("validation.invalid", ctx);
    } else if (task.attempts + 1 >= maxAttempts) {
      await deps.store.markInvalid(task, MESSAGES.exhausted, now());
      deps.logger.warn("validation.exhausted", { ...ctx, attempts: task.attempts + 1 });
    } else {
      await deps.store.release(task, outcome.error, now());
      deps.logger.warn("validation.retry", { ...ctx, attempts: task.attempts + 1 });
    }
  } catch {
    // Gravação falhou: a tarefa fica com lease/estado antigo e será reprocessada.
    deps.logger.error("validation.store_write_failed", ctx);
  }
}

/** Um ciclo: pega tarefas pendentes e valida em paralelo, isolando falhas. */
export async function runValidationOnce(deps: ValidationDeps): Promise<number> {
  const tasks = await deps.store.claimPending(deps.batchSize ?? DEFAULT_BATCH);
  await Promise.all(tasks.map((task) => processTask(task, deps)));
  return tasks.length;
}

export type ValidationLoop = { stop(): Promise<void> };

/** Laço rápido (5–10 s): ticks sequenciais, nunca sobrepostos; erro de tick não derruba o laço. */
export function startValidationLoop(
  deps: ValidationDeps & { intervalMs?: number },
): ValidationLoop {
  const intervalMs = deps.intervalMs ?? 5_000;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let wake: (() => void) | undefined;

  const loop = (async () => {
    while (!stopped) {
      try {
        await runValidationOnce(deps);
      } catch {
        deps.logger.error("validation.tick_failed");
      }
      if (stopped) break;
      await new Promise<void>((resolve) => {
        wake = resolve;
        timer = setTimeout(resolve, intervalMs);
      });
    }
  })();

  return {
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      wake?.();
      await loop;
    },
  };
}
