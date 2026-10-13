export class AlertError extends Error {
  readonly kind = "alert";
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = this.constructor.name;
    if (options?.cause !== undefined) (this as Error & { cause?: unknown }).cause = options.cause;
  }
}

export class EmailTransportError extends AlertError {}
export class EmailTimeoutError extends EmailTransportError {}
export class InvalidEmailTransportError extends AlertError {}

const SECRET_ENV_KEYS = [
  "EMAIL_PROVIDER_API_KEY",
  "EMAIL_API_KEY",
  "ALERTS_EMAIL_API_KEY",
  "EMAIL_SECRET",
  "ALERT_EMAIL_PASSWORD",
];

export function collectKnownSecrets(): string[] {
  const values: string[] = [];
  if (typeof process !== "undefined" && process.env) {
    for (const k of SECRET_ENV_KEYS) {
      const v = process.env[k];
      if (v) values.push(v);
    }
  }
  return values;
}

export function redactSecrets(text: string, extra?: string[]): string {
  let out = text;
  const secrets = [...collectKnownSecrets(), ...(extra ?? [])];
  for (const s of secrets) {
    if (s && s.length > 0) {
      out = out.split(s).join("[REDACTED]");
    }
  }
  // generic long tokens in auth headers
  out = out.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]");
  out = out.replace(/x-api-key:\s*[^\s]+/gi, "x-api-key: [REDACTED]");
  return out;
}

export function safeErrorMessage(err: unknown, extraSecrets?: string[]): string {
  if (err instanceof Error) return redactSecrets(err.message, extraSecrets);
  return redactSecrets(String(err), extraSecrets);
}

export function sanitizeContext(context?: Record<string, unknown>, extraSecrets?: string[]): Record<string, unknown> {
  if (!context) return {};
  const blocked = new Set(["secret", "secretId", "secret_id", "token", "password", "apiKey", "api_key", "apikey", "authorization"]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(context)) {
    if (blocked.has(k)) continue;
    if (typeof v === "string") out[k] = redactSecrets(v, extraSecrets);
    else if (v instanceof Error) out[k] = redactSecrets(v.message, extraSecrets);
    else out[k] = v;
  }
  return out;
}