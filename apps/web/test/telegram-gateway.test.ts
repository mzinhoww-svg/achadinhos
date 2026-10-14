import { createMockTelegramServer } from "@achadinhos/telegram";
import { describe, expect, it } from "vitest";
import { createTelegramGateway } from "@/server/telegram-gateway";

describe("gateway Telegram sobre o mock do pacote", () => {
  it("valida o bot e lista só group/supergroup/channel onde ele está", async () => {
    const mock = createMockTelegramServer({ bot: { username: "loja_bot" } });
    mock.enqueueMyChatMember({ chatId: -1001, title: "Tech", type: "supergroup", newStatus: "administrator" });
    mock.enqueueMyChatMember({ chatId: 42, title: "Privado", type: "private", newStatus: "member" });
    mock.enqueueMyChatMember({ chatId: -1002, title: "Saiu", type: "group", newStatus: "left" });
    const gw = createTelegramGateway({ transport: () => mock.transport });
    expect(await gw.verifyToken("1234567:AAAAAAAAAAAAAAAAAAAAAAAA")).toEqual({ botName: "@loja_bot" });
    const chats = await gw.listChats("1234567:AAAAAAAAAAAAAAAAAAAAAAAA");
    expect(chats.map((c) => c.name)).toEqual(["Tech"]);
  });
});
