import { InvalidTokenError, redactSecrets, TelegramTimeoutError, TelegramTransportError } from "./errors";
import type { TelegramApiResponse } from "./types";

export interface TelegramTransport {
  call?<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<TelegramApiResponse<T>>;
  request?<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<TelegramApiResponse<T>>;
}

export type Transport = TelegramTransport;

export interface FetchTransportOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  timeout?: number;
  timeoutMs?: number;
}

export class FetchTelegramTransport implements TelegramTransport {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(
    tokenOrOptions: string | { token: string } & FetchTransportOptions,
    options?: FetchTransportOptions,
  ) {
    const token =
      typeof tokenOrOptions === "string"
        ? tokenOrOptions
        : tokenOrOptions.token;
    const opts =
      typeof tokenOrOptions === "string" ? (options ?? {}) : tokenOrOptions;
    if (!token) throw new InvalidTokenError("Telegram bot token is required");
    this.token = token;
    this.baseUrl = (opts.baseUrl ?? "https://api.telegram.org").replace(/\/+$/, "");
    this.fetchFn = opts.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
    this.timeoutMs = opts.timeoutMs ?? opts.timeout ?? 10000;
  }

  async call<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<TelegramApiResponse<T>> {
    const url = `${this.baseUrl}/bot${this.token}/${method}`;
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);

    try {
      const response = await Promise.race([
        this.fetchFn(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(params ?? {}),
          signal: controller.signal,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => {
            timedOut = true;
            controller.abort();
            reject(new TelegramTimeoutError(`Timeout while calling ${method}`));
          }, this.timeoutMs),
        ),
      ]);

      let text: string;
      try {
        text = await Promise.race([
          response.text(),
          new Promise<never>((_, reject) =>
            setTimeout(() => {
              timedOut = true;
              controller.abort();
              reject(new TelegramTimeoutError(`Timeout while reading response from ${method}`));
            }, this.timeoutMs),
          ),
        ]);
      } catch (cause) {
        clearTimeout(timer);
        if (timedOut || isAbortError(cause)) {
          throw new TelegramTimeoutError(`Timeout while reading response from ${method}`);
        }
        throw new TelegramTransportError(redactSecrets(`Network error while calling ${method}`), { cause });
      }

      clearTimeout(timer);

      let data: unknown;
      try {
        data = text.trim() === "" ? {} : JSON.parse(text);
      } catch {
        return {
          ok: false,
          error_code: response.status || 500,
          description: redactSecrets(text),
        } as TelegramApiResponse<T>;
      }

      if (!data || typeof data !== "object") {
        throw new TelegramTransportError(redactSecrets(`Non-object response from ${method}`));
      }
      return data as TelegramApiResponse<T>;
    } catch (cause) {
      clearTimeout(timer);
      if (cause instanceof TelegramTimeoutError || timedOut || isAbortError(cause)) {
        throw new TelegramTimeoutError(redactSecrets(`Timeout while calling ${method}`));
      }
      const message = cause instanceof Error ? cause.message : "Network error";
      throw new TelegramTransportError(redactSecrets(`Network error while calling ${method}: ${message}`));
    }
  }
}

function isAbortError(cause: unknown): boolean {
  return (
    cause instanceof Error &&
    (cause.name === "AbortError" || /aborted/i.test(cause.message))
  );
}
