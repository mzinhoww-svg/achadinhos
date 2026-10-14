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
describe("TelegramClient group discovery safety", () => {
  it("does not mark group removed when another member leaves", async () => {
    const server = createMockTelegramServer();
    const client = new TelegramClient("t", { transport: server.transport });
    await client.getMe();
    server.enqueueMyChatMember({ chatId: -2001, title: "G", newStatus: "administrator" });
    await client.getUpdates();
    // chat_member update describing João (not the bot) leaving
    server.enqueueUpdate({
      update_id: 9,
      chat_member: {
        chat: { id: -2001, type: "supergroup", title: "G" },
        from: { id: 50, is_bot: false, first_name: "Joao" },
        date: 1,
        old_chat_member: { user: { id: 50, is_bot: false, first_name: "Joao" }, status: "member" },
        new_chat_member: { user: { id: 50, is_bot: false, first_name: "Joao" }, status: "left" },
      },
    });
    await client.getUpdates();
    const g = client.listGroups()[0];
    expect(g.active).toBe(true);
    expect(g.status).toBe("administrator");
  });

  it("ignores private chats in group list", async () => {
    const server = createMockTelegramServer();
    const client = new TelegramClient("t", { transport: server.transport });
    server.enqueueMyChatMember({ chatId: 55, title: "Private", type: "private", newStatus: "kicked" });
    await client.getUpdates();
    expect(client.listGroups()).toHaveLength(0);
  });

  it("marks group inactive after BotRemovedError on send", async () => {
    const server = createMockTelegramServer();
    const client = new TelegramClient("t", { transport: server.transport });
    server.enqueueMyChatMember({ chatId: -2002, title: "G2", newStatus: "administrator" });
    await client.getUpdates();
    server.removeBotFromChat(-2002);
    await expect(client.sendMessage({ chat_id: -2002, text: "hi" })).rejects.toBeInstanceOf(BotRemovedError);
    expect(client.listGroups({ activeOnly: true })).toHaveLength(0);
  });
});

describe("TelegramClient discoverGroups fail-closed", () => {
  it("ignores chat_member updates when getMe is unavailable", async () => {
    const server = createMockTelegramServer();
    const client = new TelegramClient("t", { transport: server.transport });
    server.setRateLimit("getMe", 3);
    server.enqueueMyChatMember({ chatId: -3001, title: "G3", newStatus: "administrator" });
    server.enqueueUpdate({
      update_id: 11,
      chat_member: {
        chat: { id: -3001, type: "supergroup", title: "G3" },
        from: { id: 55, is_bot: false, first_name: "Joao" },
        date: 1,
        old_chat_member: { user: { id: 55, is_bot: false, first_name: "Joao" }, status: "member" },
        new_chat_member: { user: { id: 55, is_bot: false, first_name: "Joao" }, status: "left" },
      },
    });
    await client.getUpdates();
    const group = client.listGroups().find((g) => g.chatId === -3001);
    expect(group).toBeTruthy();
    expect(group?.active).toBe(true);
    expect(group?.status).toBe("administrator");
  });
});
