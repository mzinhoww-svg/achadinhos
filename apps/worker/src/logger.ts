export const REDACTED = "[REDACTED]";

export type Level = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(msg: string, ctx?: Record<string, unknown>): void;
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
  addSecret(value: string): void;
}

export interface LoggerOptions {
  sink: (line: string) => void;
  secrets?: readonly string[];
  now?: () => Date;
}

const SENSITIVE_KEY = /secret|token|password|passwd|authorization|api[-_]?key|signature|credential|service[-_]?role|database[-_]?url/i;
// Token de bot do Telegram (id:segredo) e cabeçalhos Bearer.
const PATTERNS: RegExp[] = [/\d{6,}:[A-Za-z0-9_-]{30,}/g, /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi];

export function createLogger(opts: LoggerOptions): Logger {
  const secrets = new Set((opts.secrets ?? []).filter((s) => s.length >= 4));
  const now = opts.now ?? (() => new Date());

  const scrub = (s: string): string => {
    let out = s;
    for (const sec of secrets) out = out.split(sec).join(REDACTED);
    for (const p of PATTERNS) out = out.replace(p, REDACTED);
    return out;
  };

  const walk = (v: unknown, seen: WeakSet<object>): unknown => {
    if (typeof v === "string") return scrub(v);
    if (v === null || typeof v !== "object") return typeof v === "function" ? undefined : v;
    if (seen.has(v)) return "[Circular]";
    seen.add(v);
    if (v instanceof Error) {
      return {
        name: v.name,
        message: scrub(v.message),
        stack: v.stack ? scrub(v.stack) : undefined,
        cause: v.cause === undefined ? undefined : walk(v.cause, seen),
      };
    }
    if (Array.isArray(v)) return v.map((x) => walk(x, seen));
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) {
      out[k] = SENSITIVE_KEY.test(k) ? REDACTED : walk(val, seen);
    }
    return out;
  };

  const emit = (level: Level, msg: string, ctx?: Record<string, unknown>) => {
    const safeCtx = (ctx ? walk(ctx, new WeakSet()) : {}) as Record<string, unknown>;
    opts.sink(
      JSON.stringify({ ...safeCtx, ts: now().toISOString(), level, msg: scrub(msg) }),
    );
  };

  return {
    debug: (m, c) => emit("debug", m, c),
    info: (m, c) => emit("info", m, c),
    warn: (m, c) => emit("warn", m, c),
    error: (m, c) => emit("error", m, c),
    addSecret: (v) => {
      if (v.length >= 4) secrets.add(v);
    },
  };
}
