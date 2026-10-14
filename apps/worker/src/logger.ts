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
  level?: Level;
}

const ORDER: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const MAX_DEPTH = 6;
const MAX_STRING = 1024;
const MAX_ENTRIES = 50;

const SENSITIVE_KEY =
  /secret|token|password|passwd|authorization|api[-_]?key|signature|credential|service[-_]?role|database[-_]?url/i;

const PATTERNS: Array<[RegExp, string]> = [
  // Token de bot do Telegram (id:segredo), Bearer e userinfo de URL (user:senha@).
  [/\d{6,}:[A-Za-z0-9_-]{30,}/g, REDACTED],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`],
  [/(:\/\/[^\s/:@]*:)[^\s@/]+@/g, `$1${REDACTED}@`],
  // Header Shopee: Credential=<appid>, Signature=<hex>.
  [/\b(Credential|Signature)=[^\s,;&"']+/gi, `$1=${REDACTED}`],
  // chave=valor de segredo (inclusive valor URL-encoded).
  [/\b(secret|token|password|passwd|pwd|api[-_]?key|access[-_]?key|key|auth)=[^\s&,;"']+/gi, `$1=${REDACTED}`],
];

function variants(value: string): string[] {
  const out = new Set<string>([value]);
  const add = (v: string | undefined) => {
    if (v && v.length >= 4) out.add(v);
  };
  try {
    add(encodeURIComponent(value));
    add(JSON.stringify(value).slice(1, -1));
    add(Buffer.from(value).toString("base64"));
    add(Buffer.from(value).toString("base64url"));
  } catch {
    /* ignora */
  }
  try {
    const u = new URL(value);
    if (u.password) {
      add(u.password);
      try {
        add(decodeURIComponent(u.password));
      } catch {
        /* ignora */
      }
    }
  } catch {
    /* não é URL */
  }
  return [...out];
}

export function createLogger(opts: LoggerOptions): Logger {
  const secrets = new Set<string>();
  let sorted: string[] = [];
  const now = opts.now ?? (() => new Date());
  const min = ORDER[opts.level ?? "debug"];

  const addSecret = (value: string) => {
    if (typeof value !== "string" || value.length < 4) return;
    for (const v of variants(value)) secrets.add(v);
    sorted = [...secrets].sort((a, b) => b.length - a.length);
  };
  (opts.secrets ?? []).forEach(addSecret);

  const scrub = (s: string): string => {
    let out = s;
    for (const sec of sorted) out = out.split(sec).join(REDACTED);
    for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
    return out.length > MAX_STRING ? `${out.slice(0, MAX_STRING)}…[truncado ${out.length - MAX_STRING}]` : out;
  };

  const walk = (v: unknown, depth: number, path: Set<object>): unknown => {
    switch (typeof v) {
      case "string":
        return scrub(v);
      case "bigint":
        return v.toString();
      case "symbol":
        return scrub(v.toString());
      case "function":
      case "undefined":
        return undefined;
      case "object":
        break;
      default:
        return v;
    }
    if (v === null) return null;
    if (depth >= MAX_DEPTH) return "[Truncated]";
    if (path.has(v)) return "[Circular]";
    path.add(v);
    try {
      if (v instanceof Date) return Number.isNaN(v.getTime()) ? "[InvalidDate]" : v.toISOString();
      if (ArrayBuffer.isView(v) || v instanceof ArrayBuffer) return `[Binary ${(v as ArrayBufferView).byteLength} bytes]`;
      if (v instanceof Map) return `[Map ${v.size}]`;
      if (v instanceof Set) return `[Set ${v.size}]`;
      if (Array.isArray(v)) return v.slice(0, MAX_ENTRIES).map((x) => safe(() => walk(x, depth + 1, path)));
      const out: Record<string, unknown> = {};
      if (v instanceof Error) {
        out.name = safe(() => scrub(v.name));
        out.message = safe(() => scrub(v.message));
        out.stack = safe(() => (v.stack ? scrub(v.stack) : undefined));
        if (v.cause !== undefined) out.cause = safe(() => walk(v.cause, depth + 1, path));
      }
      for (const k of Object.keys(v).slice(0, MAX_ENTRIES)) {
        if (v instanceof Error && (k === "message" || k === "stack" || k === "name")) continue;
        out[k] = SENSITIVE_KEY.test(k) ? REDACTED : safe(() => walk((v as Record<string, unknown>)[k], depth + 1, path));
      }
      return out;
    } finally {
      path.delete(v);
    }
  };

  const emit = (level: Level, msg: string, ctx?: Record<string, unknown>) => {
    if (ORDER[level] < min) return;
    let line: string;
    try {
      const base = ctx ? (walk(ctx, 0, new Set()) as Record<string, unknown>) : {};
      line = JSON.stringify({ ...base, ts: now().toISOString(), level, msg: scrub(String(msg)) });
    } catch {
      line = JSON.stringify({ ts: safe(() => now().toISOString()), level, msg: safe(() => scrub(String(msg))), log_error: "contexto_nao_serializavel" });
    }
    try {
      opts.sink(line);
    } catch {
      /* o log nunca derruba o chamador */
    }
  };

  return {
    debug: (m, c) => emit("debug", m, c),
    info: (m, c) => emit("info", m, c),
    warn: (m, c) => emit("warn", m, c),
    error: (m, c) => emit("error", m, c),
    addSecret,
  };
}

function safe<T>(fn: () => T): T | string {
  try {
    return fn();
  } catch {
    return "[Unserializable]";
  }
}
