import { describe, it, expect, beforeEach } from "vitest";
import { TelegramClient, createMockTelegramServer, RateLimitedError, BotRemovedError, NoAccessError, ChatNotFoundError, CaptionTooLongError } from "../src";

describe("TelegramClient", () => {
  let server = createMockTelegramServer();
  let client: TelegramClient;

  beforeEach(() => {
    server = createMockTelegramServer();
    client = new TelegramClient("test-token", { transport: server.transport });
  });

  it("getMe returns bot info", async () => {
    const me = await client.getMe();
    expect(me.is_bot).toBe(true);
    expect(me.username).toBe("test_bot");
  });

  it("discovers groups from my_chat_member updates", async () => {
    server.enqueueMyChatMember({
      chatId: -1001,
      title: "Grupo Teste",
      newStatus: "administrator",
    });
    const updates = await client.getUpdates();
    expect(updates).toHaveLength(1);
    const groups = client.listGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].chatId).toBe(-1001);
    expect(groups[0].active).toBe(true);
    expect(groups[0].status).toBe("administrator");
  });

  it("marks group inactive when bot is removed", async () => {
    server.enqueueMyChatMember({ chatId: -1002, title: "G2", newStatus: "member" });
    await client.getUpdates();
    server.enqueueMyChatMember({ chatId: -1002, title: "G2", oldStatus: "member", newStatus: "kicked" });
    await client.getUpdates();
    const group = client.listGroups()[0];
    expect(group.active).toBe(false);
    expect(group.status).toBe("kicked");
  });

  it("sends message and photo", async () => {
    const msg = await client.sendMessage({ chat_id: -1001, text: "olá" });
    expect(msg.message_id).toBeGreaterThan(0);
    const photo = await client.sendPhoto({ chat_id: -1001, photo: "file123", caption: "curta" });
    expect(photo.caption).toBe("curta");
  });

  it("rejects photo caption longer than 300 chars", async () => {
    const long = "a".repeat(301);
    await expect(client.sendPhoto({ chat_id: -1001, photo: "x", caption: long })).rejects.toBeInstanceOf(CaptionTooLongError);
    expect(server.getSentMessages()).toHaveLength(0);
  });

  it("throws typed error when bot removed (403 kicked)", async () => {
    server.removeBotFromChat(-1009);
    await expect(client.sendMessage({ chat_id: -1009, text: "hi" })).rejects.toBeInstanceOf(BotRemovedError);
  });

  it("throws NoAccessError when no rights", async () => {
    server.setChatAccess(-1010, false);
    await expect(client.sendMessage({ chat_id: -1010, text: "hi" })).rejects.toBeInstanceOf(NoAccessError);
  });

  it("throws ChatNotFoundError for unknown chat", async () => {
    server.setChatNotFound(-1011);
    await expect(client.sendMessage({ chat_id: -1011, text: "hi" })).rejects.toBeInstanceOf(ChatNotFoundError);
  });

  it("reports 429 retry_after without retry", async () => {
    server.setRateLimit("sendMessage", 7);
    try {
      await client.sendMessage({ chat_id: -1001, text: "hi" });
    } catch (e) {
      expect(e).toBeInstanceOf(RateLimitedError);
      expect((e as RateLimitedError).retryAfter).toBe(7);
    }
    // ensure only one call happened (no retry)
    expect(server.getSentMessages()).toHaveLength(0);
  });

  it("sends verification message", async () => {
    const msg = await client.sendVerificationMessage(-1001);
    expect(msg.text).toContain("verificado");
  });

  it("getUpdates supports group discovery for message chats", async () => {
    server.enqueueUpdate({
      update_id: 5,
      message: {
        message_id: 1,
        date: 1,
        chat: { id: -2000, type: "supergroup", title: "MsgGroup" },
        text: "hi",
      },
    });
    await client.getUpdates();
    expect(client.listGroups().some((g) => g.chatId === -2000)).toBe(true);
  });

  it("aliases groups accessor", () => {
    expect(Array.isArray(client.groups)).toBe(true);
    expect(Array.isArray(client.getGroups())).toBe(true);
  });
});