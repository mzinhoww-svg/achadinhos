import { TelegramClient, type TelegramTransport, type TelegramUpdate } from "@achadinhos/telegram";
import type { TelegramGateway } from "./ports";

const GROUP_TYPES = new Set(["group", "supergroup", "channel"]);

/** Gateway sobre `packages/telegram` (timeout total vem do transporte). Em testes, recebe o transporte do mock. */
export function createTelegramGateway(opts: { transport?: (token: string) => TelegramTransport; timeoutMs?: number } = {}): TelegramGateway {
  const client = (token: string) =>
    new TelegramClient(opts.transport ? { transport: opts.transport(token) } : { token });
  return {
    async verifyToken(token) {
      const me = await client(token).getMe();
      return { botName: me.username ? `@${me.username}` : me.first_name };
    },
    async listChats(token) {
      const updates: TelegramUpdate[] = await client(token).getUpdates({ limit: 100, allowed_updates: ["my_chat_member"] });
      const found = new Map<string, { chatId: string; name: string; chatType: string; members: number }>();
      for (const u of updates) {
        const m = u.my_chat_member;
        if (!m || !GROUP_TYPES.has(m.chat.type)) continue;
        const gone = m.new_chat_member.status === "left" || m.new_chat_member.status === "kicked";
        const key = String(m.chat.id);
        if (gone) found.delete(key);
        else found.set(key, { chatId: key, name: m.chat.title ?? key, chatType: m.chat.type, members: 0 });
      }
      return [...found.values()];
    },
  };
}
