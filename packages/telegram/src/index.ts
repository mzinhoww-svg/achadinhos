export * from "./types";
export * from "./errors";
export * from "./transport";
export * from "./mock";
export * from "./client";

// Factory compat.
import { TelegramClient } from "./client";
import type { TelegramTransport } from "./transport";

export function createTelegramClient(
  tokenOrOptions?: string | { token?: string; transport?: TelegramTransport; baseUrl?: string; fetch?: typeof fetch },
  transportOrOptions?: TelegramTransport | { token?: string; transport?: TelegramTransport; baseUrl?: string; fetch?: typeof fetch },
): TelegramClient {
  return new TelegramClient(tokenOrOptions as never, transportOrOptions as never);
}
export const createBotClient = createTelegramClient;
export const createClient = createTelegramClient;
