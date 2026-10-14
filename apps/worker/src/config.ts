import { inspect } from "node:util";
import { z } from "zod";

export class ConfigError extends Error {
  readonly vars: readonly string[];
  constructor(vars: readonly string[]) {
    // Só nomes de variáveis: nunca valores (podem ser segredos).
    super(`configuração inválida: ${vars.join(", ")}`);
    this.name = "ConfigError";
    this.vars = vars;
  }
}

/** Valor sensível: não aparece em JSON, inspect nem template string. */
export class Secret {
  readonly #value: string;
  constructor(value: string) {
    this.#value = value;
  }
  reveal(): string {
    return this.#value;
  }
  toJSON(): string {
    return "[REDACTED]";
  }
  toString(): string {
    return "[REDACTED]";
  }
  [inspect.custom](): string {
    return "[REDACTED]";
  }
}

const ms = (def: number) =>
  z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().int().positive())
    .default(String(def));

const schema = z
  .object({
    DATABASE_URL: z.string().url(),
    SHOPEE_ENDPOINT: z
      .string()
      .url()
      .refine((u) => new URL(u).protocol === "https:")
      .default("https://open-api.affiliate.shopee.com.br/graphql"),
    TICK_INTERVAL_MS: ms(60_000),
    CLAIM_LEASE_MS: ms(120_000),
    EXTERNAL_TIMEOUT_MS: ms(30_000),
    HEARTBEAT_STALE_MS: ms(180_000),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  })
  .refine((c) => c.EXTERNAL_TIMEOUT_MS < c.CLAIM_LEASE_MS, {
    path: ["EXTERNAL_TIMEOUT_MS"],
  });

export interface WorkerConfig {
  readonly databaseUrl: Secret;
  readonly shopeeEndpoint: string;
  readonly tickIntervalMs: number;
  readonly leaseMs: number;
  readonly externalTimeoutMs: number;
  readonly heartbeatStaleMs: number;
  readonly logLevel: "debug" | "info" | "warn" | "error";
}

export function loadConfig(env: Record<string, string | undefined>): WorkerConfig {
  const r = schema.safeParse(env);
  if (!r.success) {
    const vars = [...new Set(r.error.issues.map((i) => String(i.path[0] ?? "config")))];
    throw new ConfigError(vars);
  }
  const c = r.data;
  return Object.freeze({
    databaseUrl: new Secret(c.DATABASE_URL),
    shopeeEndpoint: c.SHOPEE_ENDPOINT,
    tickIntervalMs: c.TICK_INTERVAL_MS,
    leaseMs: c.CLAIM_LEASE_MS,
    externalTimeoutMs: c.EXTERNAL_TIMEOUT_MS,
    heartbeatStaleMs: c.HEARTBEAT_STALE_MS,
    logLevel: c.LOG_LEVEL,
  });
}
