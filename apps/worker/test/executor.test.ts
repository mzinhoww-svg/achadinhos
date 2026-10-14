import { describe, expect, it, vi } from "vitest";
import { createMockTelegramServer, TelegramClient } from "@achadinhos/telegram";
import { ShopeeClient, startMockShopeeServer } from "@achadinhos/shopee";
import {
  createSendExecutor,
  UNKNOWN_RESULT_SUFFIX,
  type ClaimedSend,
  type ExecutorDeps,
  type FinishArgs,
} from "../src/executor.ts";
import { isUnknownResultReason } from "@achadinhos/domain";
import { PNG } from "./helpers.ts";

const SECRET_TOKEN = "123456:SUPER-SECRET-TOKEN";
const TIMEOUTS = { clientsMs: 2000, shortLinkMs: 5000, downloadMs: 5000, renderMs: 5000, storeMs: 5000, telegramMs: 5000, finishMs: 2000 };

const send: ClaimedSend = {
  sendId: "send-1",
  accountId: "acc-1",
  automationId: "auto-1",
  groupId: "grp-1",
  groupSubId: "g7",
  channelId: "chn-1",
  offerId: "off-1",
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
const withOffer = (o: Partial<ClaimedSend["offer"]>): ClaimedSend => ({ ...send, offer: { ...send.offer, ...o } });

async function setup(over: Partial<ExecutorDeps> = {}, shopeeSecret = "sec") {
  const shopeeServer = await startMockShopeeServer({ appId: "app", secret: "sec" });
  const tg = createMockTelegramServer();
  const finished: Array<[string, FinishArgs]> = [];
  const subIdsSeen: string[][] = [];
  const shopee = new ShopeeClient({ appId: "app", secret: shopeeSecret }, { endpoint: shopeeServer.url, timeoutMs: 1000 });
  const realGenerate = shopee.generateShortLink.bind(shopee);
  shopee.generateShortLink = async (p) => (subIdsSeen.push([...(p.subIds ?? [])]), realGenerate(p));
  const telegram = new TelegramClient({ transport: tg.transport });
  const sendPhoto = vi.spyOn(telegram, "sendPhoto");
  const deps: ExecutorDeps = {
    leaseMs: 60_000,
    timeouts: TIMEOUTS,
    allowedImageHosts: ["cf.shopee.com.br"],
    maxImageBytes: 1000,
    clients: async () => ({ shopee, telegram }),
    fetchImage: (async () => new Response(PNG)) as unknown as typeof fetch,
    renderCreative: async () => PNG,
    creativeStore: { put: async (_png, id) => ({ photoUrl: `https://signed.example/${id}?token=T`, objectPath: `creatives/${id}.png` }) },
    finish: async (id, args) => (finished.push([id, args]), true),
    ...over,
  };
  const executor = createSendExecutor(deps);
  return { executor, tg, finished, subIdsSeen, sendPhoto, shopee, telegram, close: () => shopeeServer.close() };
}

describe("executor do envio", () => {
  it("envia: subIds [conta, automação, sub_id do grupo, canal, envio], finish(sent) com trilha", async () => {
    const s = await setup();
    const out = await s.executor.run(send);
    expect(s.subIdsSeen).toEqual([["acc-1", "auto-1", "g7", "chn-1", "send-1"]]);
    const [msg] = s.tg.getSentMessages();
    expect(msg!.params.photo).toBe("https://signed.example/send-1?token=T");
    expect(String(msg!.params.caption)).toContain("https://shope.ee/mockshort1");
    expect(s.finished).toEqual([
      [
        "send-1",
        {
          status: "sent",
          externalMessageId: String(msg!.message.message_id),
          shortLink: "https://shope.ee/mockshort1",
          creativeUrl: "creatives/send-1.png",
          messageText: msg!.params.caption,
        },
      ],
    ]);
    expect(JSON.stringify(s.finished)).not.toContain("token=T");
    expect(out).toMatchObject({ status: "sent", finishRecorded: true });
    await s.close();
  });

  it("erro tipado do Telegram => failed com motivo, sem retry", async () => {
    const s = await setup();
    s.tg.removeBotFromChat(-100123);
    await s.executor.run(send);
    expect(s.sendPhoto).toHaveBeenCalledTimes(1);
    expect(s.finished[0]![1]).toEqual({ status: "failed", reason: "telegram_bot_removido" });
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
    const s = await setup({}, "errado");
    await s.executor.run(send);
    expect(s.sendPhoto).not.toHaveBeenCalled();
    expect(s.finished[0]![1]).toEqual({ status: "failed", reason: "shopee_assinatura_invalida" });
    await s.close();
  });

  it("imagem fora da allowlist => failed imagem_host", async () => {
    const s = await setup();
    await s.executor.run(withOffer({ imageUrl: "https://evil.example/a.png" }));
    expect(s.sendPhoto).not.toHaveBeenCalled();
    expect(s.finished[0]![1]).toEqual({ status: "failed", reason: "imagem_host" });
    await s.close();
  });

  it("falha de render => render_falhou, sem vazar a mensagem do erro", async () => {
    const s = await setup({ renderCreative: async () => { throw new Error(`boom ${SECRET_TOKEN}`); } });
    await s.executor.run(send);
    expect(JSON.stringify(s.finished)).not.toContain(SECRET_TOKEN);
    expect(s.finished[0]![1]).toEqual({ status: "failed", reason: "render_falhou" });
    await s.close();
  });

  it("recusa configuração cujos timeouts somados não cabem no lease", () => {
    expect(() => createSendExecutor({ leaseMs: 10_000, timeouts: TIMEOUTS } as never)).toThrow(/lease/);
  });
});

describe("validação da oferta antes de qualquer chamada externa (QA B1)", () => {
  const cases: Array<[string, ClaimedSend, string]> = [
    ["priceCurrent NaN", withOffer({ priceCurrent: NaN }), "oferta_invalida_priceCurrent"],
    ["priceCurrent 0", withOffer({ priceCurrent: 0 }), "oferta_invalida_priceCurrent"],
    ["priceCurrent negativo", withOffer({ priceCurrent: -5 }), "oferta_invalida_priceCurrent"],
    ["priceCurrent Infinity", withOffer({ priceCurrent: Infinity }), "oferta_invalida_priceCurrent"],
    ["priceOld menor que priceCurrent", withOffer({ priceCurrent: 100, priceOld: 50 }), "oferta_invalida_priceOld"],
    ["discountPct 150", withOffer({ discountPct: 150 }), "oferta_invalida_discountPct"],
    ["discountPct -5", withOffer({ discountPct: -5 }), "oferta_invalida_discountPct"],
    ["discountPct NaN", withOffer({ discountPct: NaN }), "oferta_invalida_discountPct"],
    ["título vazio", withOffer({ title: "   " }), "oferta_invalida_title"],
    ["título de 5000 caracteres", withOffer({ title: "x".repeat(5000) }), "oferta_invalida_title"],
    ["productUrl vazio", withOffer({ productUrl: "" }), "oferta_invalida_productUrl"],
    ["productUrl javascript:", withOffer({ productUrl: "javascript:alert(1)" }), "oferta_invalida_productUrl"],
    ["productUrl http", withOffer({ productUrl: "http://shopee.com.br/x" }), "oferta_invalida_productUrl"],
    ["imageUrl vazio", withOffer({ imageUrl: "" }), "oferta_invalida_imageUrl"],
    ["offerId nulo", { ...send, offerId: "" }, "oferta_invalida_offerId"],
    ["groupId nulo", { ...send, groupId: "" }, "oferta_invalida_groupId"],
    ["chatId nulo", { ...send, chatId: null as never }, "oferta_invalida_chatId"],
  ];
  it.each(cases)("%s => skipped sem nenhuma chamada externa", async (_n, claimed, reason) => {
    const clients = vi.fn();
    const s = await setup({ clients: clients as never });
    const out = await s.executor.run(claimed);
    expect(clients).not.toHaveBeenCalled();
    expect(s.finished).toEqual([["send-1", { status: "skipped", reason }]]);
    expect(out.status).toBe("skipped");
    await s.close();
  });
});

describe("links (QA B2, Farol B1)", () => {
  const stubShopee = (shortLink: unknown) => ({ generateShortLink: async () => ({ shortLink }) as never });
  it.each(["", "   ", "javascript:alert(1)", "http://shope.ee/x", "https://evil.example/phish", "https://evil.com/shopee.com.br", "https://shope.ee.evil.com/x", `https://shope.ee/${"a".repeat(400)}`])(
    "shortLink %j => failed link_invalido sem envio",
    async (link) => {
      const s = await setup();
      const ex = createSendExecutor({
        leaseMs: 60_000, timeouts: TIMEOUTS, allowedImageHosts: ["cf.shopee.com.br"], maxImageBytes: 1000,
        clients: async () => ({ shopee: stubShopee(link), telegram: s.telegram }),
        fetchImage: (async () => new Response(PNG)) as unknown as typeof fetch,
        renderCreative: async () => PNG,
        creativeStore: { put: async () => ({ photoUrl: "https://signed.example/x", objectPath: "p" }) },
        finish: async (id, a) => (s.finished.push([id, a]), true),
      });
      await ex.run(send);
      expect(s.sendPhoto).not.toHaveBeenCalled();
      expect(s.finished[0]![1]).toEqual({ status: "failed", reason: "link_invalido" });
      await s.close();
    },
  );
  it("productUrl fora da allowlist da Shopee => failed link_invalido antes de gerar o link", async () => {
    const s = await setup();
    await s.executor.run(withOffer({ productUrl: "https://evil.com/shopee.com.br" }));
    expect(s.subIdsSeen).toEqual([]);
    expect(s.finished[0]![1]).toEqual({ status: "failed", reason: "link_invalido" });
    await s.close();
  });
});

describe("resultado desconhecido (QA 3, Farol B2)", () => {
  it("message_id ausente, 0 ou não inteiro => failed telegram_resposta_invalida, não sent", async () => {
    for (const bad of [{}, { message_id: 0 }, { message_id: "7" }, { message_id: 1.5 }]) {
      const s = await setup();
      s.sendPhoto.mockResolvedValueOnce(bad as never);
      await s.executor.run(send);
      expect(s.finished[0]![1]).toEqual({ status: "failed", reason: "telegram_resposta_invalida_resultado_desconhecido" });
      await s.close();
    }
  });

  it("todo motivo de resultado desconhecido termina com o sufixo que o índice de dedupe reconhece", async () => {
    const s = await setup();
    vi.spyOn(s.telegram, "sendPhoto").mockImplementation(() => new Promise(() => {}));
    const ex = createSendExecutor({
      leaseMs: 7000, timeouts: { ...TIMEOUTS, clientsMs: 100, shortLinkMs: 100, downloadMs: 100, renderMs: 100, storeMs: 100, telegramMs: 100, finishMs: 100 },
      allowedImageHosts: ["cf.shopee.com.br"], maxImageBytes: 1000,
      clients: async () => ({ shopee: { generateShortLink: async () => ({ shortLink: "https://shope.ee/x" }) } as never, telegram: s.telegram }),
      fetchImage: (async () => new Response(PNG)) as unknown as typeof fetch,
      renderCreative: async () => PNG,
      creativeStore: { put: async () => ({ photoUrl: "https://signed.example/x", objectPath: "p" }) },
      finish: async (id, a) => (s.finished.push([id, a]), true),
    });
    await ex.run(send);
    const reason = (s.finished[0]![1] as { reason: string }).reason;
    expect(reason).toBe("telegram_timeout_resultado_desconhecido");
    expect(reason.endsWith(UNKNOWN_RESULT_SUFFIX)).toBe(true);
    expect(isUnknownResultReason(reason)).toBe(true); // o predicado que a seleção de ofertas deve usar
    await s.close();
  });

  it("a migração de dedupe usa o mesmo sufixo", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const dir = new URL("../../../supabase/migrations/", import.meta.url);
    const sql = readdirSync(dir).map((f) => readFileSync(new URL(f, dir), "utf8")).join("\n");
    expect(sql).toContain(`LIKE '%${UNKNOWN_RESULT_SUFFIX.replace(/_/g, "\\_")}'`);
  });
});

describe("clients() e finish() não penduram o worker (QA 4)", () => {
  it("clients() que nunca resolve => failed timeout_credenciais dentro do orçamento", async () => {
    const s = await setup({ clients: () => new Promise(() => {}), timeouts: { ...TIMEOUTS, clientsMs: 100 } });
    const t0 = Date.now();
    await s.executor.run(send);
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(s.finished[0]![1]).toEqual({ status: "failed", reason: "timeout_credenciais" });
    await s.close();
  });

  it("finish() que nunca resolve não prende o run e é tentado 3 vezes", async () => {
    let calls = 0;
    const s = await setup({ finish: () => (calls++, new Promise(() => {})), timeouts: { ...TIMEOUTS, finishMs: 100 } });
    const out = await s.executor.run(send);
    expect(calls).toBe(3);
    expect(out).toMatchObject({ status: "sent", finishRecorded: false, finishError: "finish_falhou" });
    await s.close();
  });

  it("finish() que lança com segredo: normalizado, sem propagar, com retry que se recupera", async () => {
    let calls = 0;
    const recorded: FinishArgs[] = [];
    const s = await setup({
      finish: async (_id, a) => {
        if (++calls < 3) throw new Error("db down postgres://u:SENHA@h/db");
        recorded.push(a);
        return true;
      },
    });
    const out = await s.executor.run(send);
    expect(out).toMatchObject({ finishRecorded: true });
    expect(recorded).toHaveLength(1);
    expect(JSON.stringify(out)).not.toContain("SENHA");
    await s.close();
  });

  it("finish() que devolve false (lease perdido) é reportado", async () => {
    const s = await setup({ finish: async () => false });
    const out = await s.executor.run(send);
    expect(out).toMatchObject({ status: "sent", finishRecorded: false, leaseLost: true });
    await s.close();
  });
});
