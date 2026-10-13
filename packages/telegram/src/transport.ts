import { InvalidTokenError, TelegramTransportError } from "./errors";
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

// Alias histórico/alternativo.
export type Transport = TelegramTransport;

export interface FetchTransportOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
}

export class FetchTelegramTransport implements TelegramTransport {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

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
  }

  async call<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<TelegramApiResponse<T>> {
    const url = `${this.baseUrl}/bot${this.token}/${method}`;
    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(params ?? {}),
      });
    } catch (cause) {
      throw new TelegramTransportError(`Network error while calling ${method}`, { cause });
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch (cause) {
      const text = await safeText(response);
      if (response.status === 429) {
        const retry = Number(response.headers.get("retry-after")) || 0;
        return {
          ok: false,
          error_code: 429,
          description: text || "Too Many Requests",
          parameters: { retry_after: retry },
        } as TelegramApiResponse<T>;
      }
      throw new TelegramTransportError(
        `Invalid JSON response from ${method}: ${text}`,
        { cause },
      );
    }

    if (!data || typeof data !== "object") {
      throw new TelegramTransportError(`Non-object response from ${method}`);
    }
    return data as TelegramApiResponse<T>;
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}
