import {
  CaptionTooLongError,
  classifyTelegramError,
  InvalidTokenError,
  TelegramApiError,
} from "./errors";
import type {
  GetUpdatesParams,
  SendMessageParams,
  SendPhotoParams,
  TelegramApiResponse,
  TelegramChat,
  TelegramGroup,
  TelegramMessage,
  TelegramUpdate,
  TelegramUser,
} from "./types";
import { PHOTO_CAPTION_MAX, VERIFICATION_MESSAGE_DEFAULT as VERIFICATION_DEFAULT } from "./types";
import type { TelegramTransport } from "./transport";
import { FetchTelegramTransport } from "./transport";

export interface TelegramClientOptions {
  token?: string;
  transport?: TelegramTransport;
  baseUrl?: string;
  fetch?: typeof fetch;
}

type ConstructorInput = string | TelegramClientOptions;

export class TelegramClient {
  private readonly transport: TelegramTransport;
  private readonly groupsMap = new Map<string, TelegramGroup>();

  constructor(first?: ConstructorInput, second?: TelegramTransport | TelegramClientOptions) {
    let opts: TelegramClientOptions = {};
    if (typeof first === "string") {
      opts = { token: first, ...(typeof second === "object" && second !== null && "call" in second ? {} : (second as TelegramClientOptions | undefined)) };
      if (typeof second === "object" && second !== null && "call" in second) {
        opts.transport = second as TelegramTransport;
      }
    } else if (first && typeof first === "object") {
      opts = { ...first };
      if (second && typeof second === "object" && "call" in second) {
        opts.transport = second as TelegramTransport;
      } else if (second && typeof second === "object") {
        opts = { ...opts, ...(second as TelegramClientOptions) };
      }
    }

    if (!opts.transport && !opts.token) {
      throw new InvalidTokenError("Telegram bot token is required");
    }
    this.transport = opts.transport ?? new FetchTelegramTransport(opts.token as string, {
      baseUrl: opts.baseUrl,
      fetch: opts.fetch,
    });
  }

  // ---------- Bot ----------
  async getMe(): Promise<TelegramUser> {
    const data = await this.transport.call<TelegramUser>("getMe", {});
    return this.unwrap(data, "getMe");
  }

  // ---------- Updates / grupos ----------
  async getUpdates(params?: GetUpdatesParams): Promise<TelegramUpdate[]> {
    const payload: Record<string, unknown> = {};
    if (params?.offset !== undefined) payload.offset = params.offset;
    if (params?.limit !== undefined) payload.limit = params.limit;
    if (params?.timeout !== undefined) payload.timeout = params.timeout;
    if (params?.allowed_updates !== undefined) payload.allowed_updates = params.allowed_updates;

    const data = await this.transport.call<TelegramUpdate[]>("getUpdates", payload);
    const updates = this.unwrap(data, "getUpdates");
    this.discoverGroups(updates);
    return updates;
  }

  discoverGroupsFromUpdates(updates: TelegramUpdate[]): TelegramGroup[] {
    this.discoverGroups(updates);
    return this.listGroups();
  }

  private discoverGroups(updates: TelegramUpdate[]): void {
    for (const upd of updates) {
      const cm = upd.my_chat_member;
      if (cm) {
        this.upsertGroup(cm.chat, cm.new_chat_member.status);
      }
      const msgChat = upd.message?.chat ?? upd.channel_post?.chat;
      if (msgChat && msgChat.type !== "private") {
        this.upsertGroup(msgChat, "unknown" as TelegramGroup["status"]);
      }
      const chatMember = upd.chat_member;
      if (chatMember) {
        this.upsertGroup(chatMember.chat, chatMember.new_chat_member.status);
      }
    }
  }

  private upsertGroup(chat: TelegramChat, status: TelegramGroup["status"]): void {
    const key = String(chat.id);
    const existing = this.groupsMap.get(key);
    const discoveredAt = existing?.discoveredAt ?? new Date().toISOString();
    const group: TelegramGroup = {
      chatId: chat.id,
      title: chat.title ?? existing?.title,
      type: chat.type,
      username: chat.username ?? existing?.username,
      status: status === "unknown" ? (existing?.status ?? "unknown") : status,
      active: !isInactiveStatus(status === "unknown" ? (existing?.status ?? "unknown") : status),
      discoveredAt,
    };
    this.groupsMap.set(key, group);
  }

  listGroups(options?: { activeOnly?: boolean }): TelegramGroup[] {
    const all = [...this.groupsMap.values()];
    if (options?.activeOnly) return all.filter((g) => g.active);
    return all;
  }

  get groups(): TelegramGroup[] {
    return this.listGroups();
  }

  getGroups(): TelegramGroup[] {
    return this.listGroups();
  }

  // ---------- Envio ----------
  async sendMessage(params: SendMessageParams): Promise<TelegramMessage> {
    const payload: Record<string, unknown> = { chat_id: params.chat_id, text: params.text };
    if (params.parse_mode !== undefined) payload.parse_mode = params.parse_mode;
    if (params.disable_web_page_preview !== undefined) payload.disable_web_page_preview = params.disable_web_page_preview;
    if (params.disable_notification !== undefined) payload.disable_notification = params.disable_notification;
    if (params.reply_to_message_id !== undefined) payload.reply_to_message_id = params.reply_to_message_id;

    const data = await this.transport.call<TelegramMessage>("sendMessage", payload);
    const message = this.unwrap(data, "sendMessage");
    if (message.chat && message.chat.type !== "private") {
      this.upsertGroup(message.chat, "unknown" as TelegramGroup["status"]);
    }
    return message;
  }

  async sendPhoto(params: SendPhotoParams): Promise<TelegramMessage> {
    if (params.caption !== undefined && params.caption.length > PHOTO_CAPTION_MAX) {
      throw new CaptionTooLongError(
        `Caption too long: ${params.caption.length} > ${PHOTO_CAPTION_MAX}`,
      );
    }
    const payload: Record<string, unknown> = { chat_id: params.chat_id, photo: params.photo };
    if (params.caption !== undefined) payload.caption = params.caption;
    if (params.parse_mode !== undefined) payload.parse_mode = params.parse_mode;
    if (params.disable_notification !== undefined) payload.disable_notification = params.disable_notification;
    if (params.reply_to_message_id !== undefined) payload.reply_to_message_id = params.reply_to_message_id;

    const data = await this.transport.call<TelegramMessage>("sendPhoto", payload);
    const message = this.unwrap(data, "sendPhoto");
    if (message.chat && message.chat.type !== "private") {
      this.upsertGroup(message.chat, "unknown" as TelegramGroup["status"]);
    }
    return message;
  }

  // ---------- Verificação ----------
  async sendVerificationMessage(
    chatIdOrParams: number | string | { chat_id: number | string; text?: string },
    text?: string,
  ): Promise<TelegramMessage> {
    let chatId: number | string;
    let messageText: string;
    if (typeof chatIdOrParams === "object" && chatIdOrParams !== null) {
      chatId = chatIdOrParams.chat_id;
      messageText = chatIdOrParams.text ?? VERIFICATION_DEFAULT;
    } else {
      chatId = chatIdOrParams as number | string;
      messageText = text ?? VERIFICATION_DEFAULT;
    }
    return this.sendMessage({ chat_id: chatId, text: messageText });
  }

  async verifyGroup(
    chatId: number | string,
    text?: string,
  ): Promise<{ ok: true; message: TelegramMessage }> {
    const message = await this.sendVerificationMessage(chatId, text);
    return { ok: true, message };
  }

  async verifyAccess(chatId: number | string, text?: string): Promise<TelegramMessage> {
    return this.sendVerificationMessage(chatId, text);
  }

  // ---------- unwrap ----------
  private unwrap<T>(data: TelegramApiResponse<T>, method: string): T {
    if (!data || typeof data !== "object") {
      throw new TelegramApiError(`Invalid response from ${method}`, { method });
    }
    if (data.ok === true) {
      if (data.result === undefined) {
        throw new TelegramApiError(`Missing result in ${method} response`, { method });
      }
      return data.result;
    }
    throw classifyTelegramError(data, method);
  }
}

function isInactiveStatus(status: TelegramGroup["status"]): boolean {
  return status === "left" || status === "kicked";
}

// Re-export compat aliases.
export { TelegramClient as BotClient, TelegramClient as TelegramBotClient, TelegramClient as Client };
export type { TelegramClientOptions as ClientOptions };
