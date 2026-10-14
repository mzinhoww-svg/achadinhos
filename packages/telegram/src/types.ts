// Telegram Bot API — tipos mínimos e tipados (sem `any` exposto).

export type ChatType = "private" | "group" | "supergroup" | "channel";

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  can_join_groups?: boolean;
  can_read_all_group_messages?: boolean;
  supports_inline_queries?: boolean;
}

export interface TelegramChat {
  id: number | string;
  type: ChatType;
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface PhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TelegramMessage {
  message_id: number;
  date: number;
  chat: TelegramChat;
  from?: TelegramUser;
  text?: string;
  caption?: string;
  photo?: PhotoSize[];
}

export interface ChatMember {
  user: TelegramUser;
  status: "creator" | "administrator" | "member" | "restricted" | "left" | "kicked";
  // campos adicionais (custom_title etc.) omitidos por simplicidade
  until_date?: number;
  is_anonymous?: boolean;
  can_be_edited?: boolean;
}

export interface ChatMemberUpdated {
  chat: TelegramChat;
  from: TelegramUser;
  date: number;
  old_chat_member: ChatMember;
  new_chat_member: ChatMember;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
  edited_channel_post?: TelegramMessage;
  my_chat_member?: ChatMemberUpdated;
  chat_member?: ChatMemberUpdated;
}

export interface GetUpdatesParams {
  offset?: number;
  limit?: number;
  timeout?: number;
  allowed_updates?: string[];
}

export interface SendMessageParams {
  chat_id: number | string;
  text: string;
  parse_mode?: "HTML" | "Markdown" | "MarkdownV2";
  disable_web_page_preview?: boolean;
  disable_notification?: boolean;
  reply_to_message_id?: number;
}

export interface SendPhotoParams {
  chat_id: number | string;
  photo: string; // file_id ou URL
  caption?: string;
  parse_mode?: "HTML" | "Markdown" | "MarkdownV2";
  disable_notification?: boolean;
  reply_to_message_id?: number;
}

export interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
  parameters?: {
    retry_after?: number;
    migrate_to_chat_id?: number;
  };
}

export interface TelegramGroup {
  chatId: number | string;
  title?: string;
  type: ChatType;
  username?: string;
  status: ChatMember["status"] | "unknown";
  active: boolean;
  discoveredAt: string; // ISO
}

export const VERIFICATION_MESSAGE_DEFAULT = "✅ Bot verificado e pronto para envio.";
export const PHOTO_CAPTION_MAX = 300;
export const TELEGRAM_TEXT_MAX = 4096;
