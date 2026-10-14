import { MemoryAutomations, MemoryConnections, MemoryVault } from "../src/server/memory";
import type { TelegramGateway } from "../src/server/ports";
import type { Session, SessionProvider } from "../src/server/session";

export const SECRET_CANARY = "SHOPEE-SECRET-CANARY-9f3a7c1d5e";
export const TOKEN_CANARY = "7123456789:AAH-CANARY-token_b0t_9f3a7c1d5e2b4a6c";

export function sessionOf(accountId: string | null): SessionProvider {
  const s: Session | null = accountId ? { accountId, userId: `u_${accountId}` } : null;
  return { current: async () => s };
}

export function fakeTelegram(): TelegramGateway & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async verifyToken(token) {
      calls.push("verify");
      if (token !== TOKEN_CANARY) throw new Error(`Unauthorized: bot${token} rejeitado`);
      return { botName: "@achadinhos_teste_bot" };
    },
    async listChats() {
      return [
        { chatId: "-1001", name: "Grupo Tech", chatType: "supergroup", members: 120 },
        { chatId: "-1002", name: "Canal Casa", chatType: "channel", members: 50 },
        { chatId: "555", name: "Conversa privada", chatType: "private", members: 1 },
      ];
    },
  };
}

export function build(accountId: string | null = "acc_A") {
  const connections = new MemoryConnections();
  const automations = new MemoryAutomations(() => "2026-10-13T12:00:00.000Z");
  const vault = new MemoryVault();
  const telegram = fakeTelegram();
  return { connections, automations, vault, telegram, session: sessionOf(accountId), accountId };
}
