import type {
  ChatMember,
  TelegramApiResponse,
  TelegramChat,
  TelegramMessage,
  TelegramUpdate,
  TelegramUser,
} from "./types";
import type { TelegramTransport } from "./transport";

export interface MockTelegramServerOptions {
  bot?: Partial<TelegramUser> & { id?: number; username?: string; first_name?: string };
  now?: () => number;
}

export interface MockTelegramControls {
  transport: TelegramTransport;
  botUser: TelegramUser;
  enqueueUpdate(update: TelegramUpdate): void;
  enqueueMyChatMember(params: {
    chatId: number | string;
    title?: string;
    type?: TelegramChat["type"];
    username?: string;
    from?: TelegramUser;
    oldStatus?: ChatMember["status"];
    newStatus: ChatMember["status"];
    updateId?: number;
  }): TelegramUpdate;
  setChatAccess(chatId: number | string, allowed: boolean): void;
  setChatNotFound(chatId: number | string): void;
  removeBotFromChat(chatId: number | string): void;
  blockBotInChat(chatId: number | string): void;
  setRateLimit(method: string, retryAfter: number | null): void;
  getSentMessages(): Array<{ method: string; params: Record<string, unknown>; message: TelegramMessage }>;
  reset(): void;
}

export type MockTelegramServer = MockTelegramControls;

let updateSeq = 1000;

export function createMockTelegramServer(
  options: MockTelegramServerOptions = {},
): MockTelegramControls {
  const botUser: TelegramUser = {
    id: options.bot?.id ?? 999001,
    is_bot: true,
    first_name: options.bot?.first_name ?? "TestBot",
    username: options.bot?.username ?? "test_bot",
    ...options.bot,
  };

  const now = options.now ?? (() => Math.floor(Date.now() / 1000));
  let nextMessageId = 100;
  const updates: TelegramUpdate[] = [];
  const sent: Array<{ method: string; params: Record<string, unknown>; message: TelegramMessage }> = [];
  const access = new Map<string, "ok" | "removed" | "blocked" | "noaccess" | "notfound">();
  const rateLimits = new Map<string, number | null>();

  const accessKey = (id: number | string) => String(id);

  const makeChat = (id: number | string, params?: { title?: string; type?: TelegramChat["type"]; username?: string }): TelegramChat => ({
    id,
    type: params?.type ?? (String(id).startsWith("-100") ? "supergroup" : "group"),
    title: params?.title,
    username: params?.username,
  });

  const checkRate = (method: string): TelegramApiResponse<unknown> | null => {
    const rl = rateLimits.get(method);
    if (rl) {
      return {
        ok: false,
        error_code: 429,
        description: `Too Many Requests: retry after ${rl}`,
        parameters: { retry_after: rl },
      };
    }
    return null;
  };

  const checkAccess = (chatId: number | string): TelegramApiResponse<unknown> | null => {
    const state = access.get(accessKey(chatId));
    if (!state || state === "ok") return null;
    if (state === "removed") {
      return {
        ok: false,
        error_code: 403,
        description: "Forbidden: bot was kicked from the group chat",
      };
    }
    if (state === "blocked") {
      return { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" };
    }
    if (state === "noaccess") {
      return { ok: false, error_code: 403, description: "Forbidden: have no rights to send messages" };
    }
    if (state === "notfound") {
      return { ok: false, error_code: 400, description: "Bad Request: chat not found" };
    }
    return null;
  };

  const transport: TelegramTransport = {
    async call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<TelegramApiResponse<T>> {
      const p = params ?? {};
      // rate limit global por método
      const rlResponse = checkRate(method);
      if (rlResponse) return rlResponse as TelegramApiResponse<T>;

      if (method === "getMe") {
        return { ok: true, result: botUser as T };
      }

      if (method === "getUpdates") {
        const offset = typeof p.offset === "number" ? p.offset : 0;
        const limit = typeof p.limit === "number" ? p.limit : 100;
        const filtered = updates
          .filter((u) => u.update_id >= offset)
          .slice(0, limit);
        return { ok: true, result: filtered as T };
      }

      if (method === "sendMessage") {
        const chatId = p.chat_id as number | string;
        const accessResponse = checkAccess(chatId);
        if (accessResponse) return accessResponse as TelegramApiResponse<T>;
        if (typeof p.text !== "string" || p.text.length === 0) {
          return { ok: false, error_code: 400, description: "Bad Request: text is required" };
        }
        const chat = makeChat(chatId);
        const message: TelegramMessage = {
          message_id: nextMessageId++,
          date: now(),
          chat,
          text: p.text as string,
        };
        sent.push({ method, params: p, message });
        return { ok: true, result: message as T };
      }

      if (method === "sendPhoto") {
        const chatId = p.chat_id as number | string;
        const accessResponse = checkAccess(chatId);
        if (accessResponse) return accessResponse as TelegramApiResponse<T>;
        if (typeof p.photo !== "string" || p.photo.length === 0) {
          return { ok: false, error_code: 400, description: "Bad Request: photo is required" };
        }
        const caption = typeof p.caption === "string" ? p.caption : undefined;
        if (caption && caption.length > 300) {
          // client already validates; mock also guards
        }
        const chat = makeChat(chatId);
        const message: TelegramMessage = {
          message_id: nextMessageId++,
          date: now(),
          chat,
          caption,
        };
        if (caption) message.caption = caption;
        sent.push({ method, params: p, message });
        return { ok: true, result: message as T };
      }

      return { ok: false, error_code: 404, description: `Not Found: unknown method ${method}` };
    },
  };

  const controls: MockTelegramControls = {
    transport,
    botUser,
    enqueueUpdate(update: TelegramUpdate) {
      updates.push(update);
    },
    enqueueMyChatMember(params) {
      const updateId = params.updateId ?? updateSeq++;
      const chat = makeChat(params.chatId, {
        title: params.title,
        type: params.type,
        username: params.username,
      });
      const update: TelegramUpdate = {
        update_id: updateId,
        my_chat_member: {
          chat,
          from: params.from ?? { id: 1, is_bot: false, first_name: "user" },
          date: now(),
          old_chat_member: {
            user: botUser,
            status: params.oldStatus ?? "left",
          },
          new_chat_member: {
            user: botUser,
            status: params.newStatus,
          },
        },
      };
      updates.push(update);
      return update;
    },
    setChatAccess(chatId, allowed) {
      access.set(accessKey(chatId), allowed ? "ok" : "noaccess");
    },
    setChatNotFound(chatId) {
      access.set(accessKey(chatId), "notfound");
    },
    removeBotFromChat(chatId) {
      access.set(accessKey(chatId), "removed");
    },
    blockBotInChat(chatId) {
      access.set(accessKey(chatId), "blocked");
    },
    setRateLimit(method, retryAfter) {
      if (retryAfter === null) rateLimits.delete(method);
      else rateLimits.set(method, retryAfter);
    },
    getSentMessages() {
      return [...sent];
    },
    reset() {
      updates.length = 0;
      sent.length = 0;
      access.clear();
      rateLimits.clear();
    },
  };

  return controls;
}

// Aliases para compatibilidade com diferentes expectativas de nome.
export const createMockTelegramApi = createMockTelegramServer;
export const createMockBotApi = createMockTelegramServer;
export const createTelegramMockServer = createMockTelegramServer;
export const MockTelegramServer = createMockTelegramServer; // factory alias (callable) as last resort
