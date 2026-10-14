export class TelegramError extends Error {
  readonly kind = "telegram";
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = this.constructor.name;
    if (options?.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

export interface TelegramApiErrorInit {
  method?: string;
  code?: number;
  description?: string;
  parameters?: { retry_after?: number; migrate_to_chat_id?: number };
  retryAfter?: number;
}

export class TelegramApiError extends TelegramError {
  readonly method?: string;
  readonly code?: number;
  readonly description?: string;
  readonly parameters?: { retry_after?: number; migrate_to_chat_id?: number };
  constructor(message: string, init?: TelegramApiErrorInit & { cause?: unknown }) {
    super(message, { cause: init?.cause });
    this.method = init?.method;
    this.code = init?.code;
    this.description = init?.description ?? message;
    this.parameters = init?.parameters;
  }
}

export class RateLimitedError extends TelegramApiError {
  readonly retryAfter: number;
  constructor(
    message: string,
    init?: TelegramApiErrorInit & { retryAfter?: number; cause?: unknown },
  ) {
    super(message, init);
    this.retryAfter = init?.retryAfter ?? init?.parameters?.retry_after ?? 0;
    (this as { name: string }).name = "RateLimitedError";
  }
}

export class BotRemovedError extends TelegramApiError {}
export class BotBlockedError extends TelegramApiError {}
export class NoAccessError extends TelegramApiError {}
export class ChatNotFoundError extends TelegramApiError {}
export class CaptionTooLongError extends TelegramError {}
export class InvalidTokenError extends TelegramError {}
export class TelegramTransportError extends TelegramError {}
export class TelegramTimeoutError extends TelegramTransportError {}
export class ConflictError extends TelegramApiError {}

export function redactSecrets(text: string): string {
  return text.replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot[REDACTED]");
}

export function classifyTelegramError(
  data: { error_code?: number; description?: string; parameters?: { retry_after?: number; migrate_to_chat_id?: number } },
  method: string,
): TelegramApiError {
  const code = data.error_code ?? 0;
  const description = redactSecrets(data.description ?? "Telegram API error");
  const lower = description.toLowerCase();
  const retryAfter = data.parameters?.retry_after;

  if (code === 429) {
    const parsedRetry = retryAfter ?? parseRetryAfter(description);
    return new RateLimitedError(description, {
      method,
      code,
      description,
      parameters: data.parameters,
      retryAfter: parsedRetry,
    });
  }

  const makeInit = (extra?: Partial<TelegramApiErrorInit>) => ({
    method,
    code,
    description,
    parameters: data.parameters,
    ...extra,
  });

  if (code === 409) {
    return new ConflictError(description, makeInit());
  }

  if (lower.includes("chat not found")) {
    return new ChatNotFoundError(description, makeInit());
  }
  if (
    lower.includes("kicked") ||
    lower.includes("removed") ||
    lower.includes("not a member") ||
    lower.includes("bot is not a member") ||
    lower.includes("left the group")
  ) {
    return new BotRemovedError(description, makeInit());
  }
  if (lower.includes("blocked") || lower.includes("have blocked")) {
    return new BotBlockedError(description, makeInit());
  }
  if (
    lower.includes("have no rights") ||
    lower.includes("not enough rights") ||
    (lower.includes("forbidden") && !lower.includes("blocked"))
  ) {
    // heurística: 403 Forbidden genérico sem palavra-chave mais específica = sem acesso
    if (code === 403) {
      return new NoAccessError(description, makeInit());
    }
  }
  // 403 genérico vira sem acesso (bot removido tratado acima)
  if (code === 403 && !lower.includes("blocked")) {
    return new NoAccessError(description, makeInit());
  }
  return new TelegramApiError(description, makeInit());
}

function parseRetryAfter(description: string): number {
  const m = description.match(/retry after\s+(\d+)/i) ?? description.match(/retry_after\s*[:=]\s*(\d+)/i);
  if (m) return Number(m[1]);
  return 0;
}
