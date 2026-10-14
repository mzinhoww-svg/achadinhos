import { describe, expect, it, vi } from "vitest";
import { createMockTelegramServer, TelegramClient } from "@achadinhos/telegram";
import { ShopeeClient, startMockShopeeServer } from "@achadinhos/shopee";
import { createSendExecutor, type ClaimedSend, type FinishArgs } from "../src/executor.ts";
import { PNG } from "./helpers.ts";

const SECRET_TOKEN = "123456:SUPER-SECRET-TOKEN";

const send: ClaimedSend = {
  sendId: "send-1",
  accountId: "acc-1",
  automationId: "auto-1",
  groupId: "grp-1",
  channelId: "chn-1",
  chatId: -100123,
  affiliateHandle: "achadinhos",
  offer: {
    title: "Fone Bluetooth",
    imageUrl: "https://cf.shopee.com.br/file/abc",
    productUrl: "https://shopee.com.br/produto-i.1.900001",
    priceCurrent: 99.9,
    priceOld: 199.9,
    discountPct: 50,
  },
};

async function setup(opts: { shopeeSecret?: string } = {}) {
  const shopeeServer = await startMockShopeeServer({ appId: "app", secret: "sec" });
  const tg = createMockTelegramServer();
  const finished: Array<[string, FinishArgs]> = [];
  const subIdsSeen: string[][] = [];
  const shopee = new ShopeeClient(
    { appId: "app", secret: opts.shopeeSecret ?? "sec" },
    { endpoint: shopeeServer.url, timeoutMs: 1000 },
  );
  const realGenerate = shopee.generateShortLink.bind(shopee);
  shopee.generateShortLink = async (p) => (subIdsSeen.push([...(p.subIds ?? [])]), realGenerate(p));
  const telegram = new TelegramClient({ transport: tg.transport });
  const sendPhoto = vi.spyOn(telegram, "sendPhoto");
  const executor = createSendExecutor({
    leaseMs: 60_000,
    timeouts: { shortLinkMs: 5000, downloadMs: 5000, renderMs: 5000, storeMs: 5000, telegramMs: 5000 },
    allowedImageHosts: ["cf.shopee.com.br"],
    maxImageBytes: 1000,
    clients: async () => ({ shopee, telegram }),
    fetchImage: (async () => new Response(PNG)) as unknown as typeof fetch,
    renderCreative: async () => PNG,
    creativeStore: { put: async (_png, id) => `https://signed.example/${id}` },
    finish: async (id, args) => void finished.push([id, args]),
  });
  return { executor, tg, finished, subIdsSeen, sendPhoto, close: () => shopeeServer.close() };
}

describe("executor do envio", () => {
  it("envia: subIds [conta, automação, grupo, canal, envio], sendPhoto e finish(sent)", async () => {
    const s = await setup();
    await s.executor.run(send);
    expect(s.subIdsSeen).toEqual([["acc-1", "auto-1", "grp-1", "chn-1", "send-1"]]);
    const [msg] = s.tg.getSentMessages();
    expect(msg!.method).toBe("sendPhoto");
    expect(msg!.params.photo).toBe("https://signed.example/send-1");
    expect(String(msg!.params.caption)).toContain("https://shope.ee/mockshort1");
    expect(String(msg!.params.caption).length).toBeLessThanOrEqual(300);
    expect(s.finished).toEqual([["send-1", { status: "sent", externalMessageId: String(msg!.message.message_id) }]]);
    await s.close();
  });

  it("erro tipado do Telegram => failed com motivo, sem retry", async () => {
    const s = await setup();
    s.tg.removeBotFromChat(-100123);
    await s.executor.run(send);
    expect(s.sendPhoto).toHaveBeenCalledTimes(1);
    expect(s.finished).toEqual([["send-1", { status: "failed", reason: "telegram_bot_removido" }]]);
    await s.close();
  });

  it("rate limit => failed, sem retry", async () => {
    const s = await setup();
    s.tg.setRateLimit("sendPhoto", 30);
    await s.executor.run(send);
    expect(s.sendPhoto).toHaveBeenCalledTimes(1);
    expect(s.finished[0]![1]).toEqual({ status: "failed", reason: "telegram_rate_limit" });
    await s.close();
  });

  it("assinatura Shopee inválida => failed e nada vai ao Telegram", async () => {
    const s = await setup({ shopeeSecret: "errado" });
    await s.executor.run(send);
    expect(s.sendPhoto).not.toHaveBeenCalled();
    expect(s.finished[0]![1]).toEqual({ status: "failed", reason: "shopee_assinatura_invalida" });
    await s.close();
  });

  it("imagem fora da allowlist => failed imagem_host", async () => {
    const s = await setup();
    await s.executor.run({ ...send, offer: { ...send.offer, imageUrl: "https://evil.example/a.png" } });
    expect(s.sendPhoto).not.toHaveBeenCalled();
    expect(s.finished[0]![1]).toEqual({ status: "failed", reason: "imagem_host" });
    await s.close();
  });

  it("falha de render => failed render_falhou", async () => {
    const s = await setup();
    const ex = createSendExecutor({
      leaseMs: 60_000,
      timeouts: { shortLinkMs: 5000, downloadMs: 5000, renderMs: 5000, storeMs: 5000, telegramMs: 5000 },
      allowedImageHosts: ["cf.shopee.com.br"],
      maxImageBytes: 1000,
      clients: async () => ({ shopee: new ShopeeClient({ appId: "app", secret: "sec" }), telegram: new TelegramClient({ transport: s.tg.transport }) }),
      fetchImage: (async () => new Response(PNG)) as unknown as typeof fetch,
      renderCreative: async () => { throw new Error(`boom ${SECRET_TOKEN}`); },
      creativeStore: { put: async () => "x" },
      finish: async (id, args) => void s.finished.push([id, args]),
    });
    await ex.run(send);
    expect(JSON.stringify(s.finished)).not.toContain(SECRET_TOKEN);
    expect(s.finished.at(-1)![1]).toMatchObject({ status: "failed" });
    await s.close();
  });

  it("timeout do Telegram => failed com resultado desconhecido, motivo sem segredo", async () => {
    const s = await setup();
    vi.spyOn(TelegramClient.prototype, "sendPhoto").mockImplementation(() => new Promise(() => {}));
    const ok = { generateShortLink: async () => ({ shortLink: "https://shope.ee/x" }) };
    const ex2 = createSendExecutor({
      leaseMs: 6000,
      timeouts: { shortLinkMs: 200, downloadMs: 200, renderMs: 200, storeMs: 200, telegramMs: 100 },
      allowedImageHosts: ["cf.shopee.com.br"],
      maxImageBytes: 1000,
      clients: async () => ({ shopee: ok as never, telegram: new TelegramClient({ transport: s.tg.transport }) }),
      fetchImage: (async () => new Response(PNG)) as unknown as typeof fetch,
      renderCreative: async () => PNG,
      creativeStore: { put: async () => "https://signed.example/x" },
      finish: async (id, args) => void s.finished.push([id, args]),
    });
    await ex2.run(send);
    expect(s.finished.at(-1)![1]).toEqual({ status: "failed", reason: "telegram_timeout_resultado_desconhecido" });
    vi.restoreAllMocks();
    await s.close();
  });

  it("recusa configuração cujos timeouts somados não cabem no lease", () => {
    expect(() =>
      createSendExecutor({
        leaseMs: 10_000,
        timeouts: { shortLinkMs: 5000, downloadMs: 5000, renderMs: 5000, storeMs: 5000, telegramMs: 5000 },
      } as never),
    ).toThrow(/lease/);
  });
});
