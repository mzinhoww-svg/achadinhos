import { describe, expect, it } from "vitest";
import { selectOffer } from "../../src/offer-selection.js";
import type { SendHistoryRow } from "../../src/scheduler-ports.js";
import { node } from "./helpers.js";

const HOSTS = { imageHosts: ["img", "susercontent.com"] };
const NOW = new Date("2026-10-13T16:00:00Z");
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

function source(nodes = [node({ itemId: 1 }), node({ itemId: 2, productName: "Cabo USB" })]) {
  const calls: unknown[] = [];
  return {
    calls,
    productOfferV2: async (p: unknown) => {
      calls.push(p);
      return { nodes, pageInfo: { limit: 20, hasNextPage: false } };
    },
  };
}

const sentOn = (itemId: number, when: Date, extra: Partial<SendHistoryRow> = {}): SendHistoryRow => ({
  itemId: String(itemId),
  status: "sent",
  reason: null,
  sentAt: when,
  attemptedAt: when,
  createdAt: when,
  ...extra,
});

describe("T7-05 seleção de oferta e antirrepetição", () => {
  it("devolve a primeira oferta que passa nos filtros", async () => {
    const r = await selectOffer({ source: source(), filters: {}, history: [], now: NOW, dedupeDays: 7, groupId: "g1", ...HOSTS });
    expect(r).toMatchObject({ kind: "offer", offer: { itemId: 1 } });
  });

  it("aplica filtros da automação (palavra-chave, preço)", async () => {
    const r = await selectOffer({ source: source(), filters: { keywords: "cabo" }, history: [], now: NOW, dedupeDays: 7, groupId: "g1", ...HOSTS });
    expect(r).toMatchObject({ kind: "offer", offer: { itemId: 2 } });
    const caro = await selectOffer({ source: source(), filters: { priceMin: 500 }, history: [], now: NOW, dedupeDays: 7, groupId: "g1", ...HOSTS });
    expect(caro).toEqual({ kind: "none", reason: "sem_oferta" });
  });

  it("repassa a primeira palavra-chave à Shopee e limita o tamanho da página", async () => {
    const src = source();
    await selectOffer({ source: src, filters: { keywords: ["cabo", "usb"] }, history: [], now: NOW, dedupeDays: 7, groupId: "g1", ...HOSTS });
    expect(src.calls[0]).toMatchObject({ keyword: "cabo usb", page: 1 });
  });

  it("pula item enviado há menos de 7 dias; no dia 8 volta a poder enviar", async () => {
    const dentro = await selectOffer({ source: source(), filters: {}, history: [sentOn(1, day(6))], now: NOW, dedupeDays: 7, groupId: "g1", ...HOSTS });
    expect(dentro).toMatchObject({ offer: { itemId: 2 } });

    const dia8 = await selectOffer({ source: source(), filters: {}, history: [sentOn(1, day(8))], now: NOW, dedupeDays: 7, groupId: "g1", ...HOSTS });
    expect(dia8).toMatchObject({ offer: { itemId: 1 } });
  });

  it("bloqueia failed de resultado desconhecido, mas não falha limpa nem skipped (decisão 001 A5)", async () => {
    const desconhecido = sentOn(1, day(1), { status: "failed", reason: "lease_expirado_resultado_desconhecido" });
    const limpa = sentOn(1, day(1), { status: "failed", reason: "telegram_400" });
    const pulada = sentOn(1, day(1), { status: "skipped", reason: "fora_da_janela" });

    expect(await selectOffer({ source: source(), filters: {}, history: [desconhecido], now: NOW, dedupeDays: 7, groupId: "g1", ...HOSTS })).toMatchObject({ offer: { itemId: 2 } });
    expect(await selectOffer({ source: source(), filters: {}, history: [limpa], now: NOW, dedupeDays: 7, groupId: "g1", ...HOSTS })).toMatchObject({ offer: { itemId: 1 } });
    expect(await selectOffer({ source: source(), filters: {}, history: [pulada], now: NOW, dedupeDays: 7, groupId: "g1", ...HOSTS })).toMatchObject({ offer: { itemId: 1 } });
  });

  it("queued e sending bloqueiam o mesmo item (evita corrida entre automações)", async () => {
    const q = sentOn(1, day(0), { status: "queued", sentAt: null, attemptedAt: null });
    expect(await selectOffer({ source: source(), filters: {}, history: [q], now: NOW, dedupeDays: 7, groupId: "g1", ...HOSTS })).toMatchObject({ offer: { itemId: 2 } });
  });

  it("tudo repetido ⇒ none/repetida", async () => {
    const r = await selectOffer({ source: source(), filters: {}, history: [sentOn(1, day(1)), sentOn(2, day(2))], now: NOW, dedupeDays: 7, groupId: "g1", ...HOSTS });
    expect(r).toEqual({ kind: "none", reason: "repetida" });
  });

  it("deadline total: Shopee que não responde vira erro, não trava o tick", async () => {
    const hang = { productOfferV2: () => new Promise<never>(() => {}) };
    await expect(
      selectOffer({ source: hang, filters: {}, history: [], now: NOW, dedupeDays: 7, groupId: "g1", timeoutMs: 25, ...HOSTS }),
    ).rejects.toThrow(/timeout/i);
  });

  describe("nó inválido da Shopee não envenena o grupo (QA #14 bloqueante)", () => {
    const invalidos: [string, Partial<ReturnType<typeof node>>][] = [
      ["offerLink javascript:", { offerLink: "javascript:alert(1)" }],
      ["offerLink vazio", { offerLink: "" }],
      ["imageUrl vazio", { imageUrl: "" }],
      ["imageUrl http:", { imageUrl: "http://img/1.jpg" }],
      ["productName vazio", { productName: "  " }],
      ["priceMin NaN", { priceMin: Number.NaN }],
      ["priceMin zero", { priceMin: 0 }],
      ["itemId ausente", { itemId: undefined as unknown as number }],
    ];
    for (const [nome, defeito] of invalidos) {
      it(`pula ${nome} e devolve o próximo válido`, async () => {
        const src = source([node({ itemId: 111, ...defeito }), node({ itemId: 222 })]);
        const r = await selectOffer({ source: src, filters: {}, history: [], now: NOW, dedupeDays: 7, groupId: "g1", ...HOSTS });
        expect(r).toMatchObject({ kind: "offer", offer: { itemId: 222 } });
      });
    }

    it("só inválidos ⇒ none/sem_oferta e informa os descartados com motivo", async () => {
      const dropped: unknown[] = [];
      const src = source([node({ itemId: 111, offerLink: "" }), node({ itemId: 112, priceMin: Number.NaN })]);
      const r = await selectOffer({
        source: src, filters: {}, history: [], now: NOW, dedupeDays: 7, groupId: "g1", ...HOSTS,
        onDiscard: (d) => dropped.push(d),
      });
      expect(r).toEqual({ kind: "none", reason: "sem_oferta" });
      expect(dropped).toEqual([
        { itemId: "111", reason: "oferta_invalida_offerLink" },
        { itemId: "112", reason: "oferta_invalida_priceCurrent" },
      ]);
    });
  });

  it("histórico sem data válida bloqueia (fail-closed)", async () => {
    const semData = { ...sentOn(1, NOW), sentAt: null, attemptedAt: null, createdAt: new Date("x") };
    const r = await selectOffer({ source: source(), filters: {}, history: [semData], now: NOW, dedupeDays: 7, groupId: "g1", ...HOSTS });
    expect(r).toMatchObject({ offer: { itemId: 2 } });
  });

  it("resposta malformada vira erro tipado, não TypeError", async () => {
    for (const bad of [null, {}, { nodes: null }]) {
      const src = { productOfferV2: async () => bad as never };
      await expect(
        selectOffer({ source: src, filters: {}, history: [], now: NOW, dedupeDays: 7, groupId: "g1", ...HOSTS }),
      ).rejects.toMatchObject({ name: "OfferSourceError" });
    }
  });

  describe("mesmo critério do executor (QA #14 reteste, bloqueante 1)", () => {
    const rejeitados: [string, Partial<ReturnType<typeof node>>][] = [
      ["imageUrl de host fora da allowlist", { imageUrl: "https://evil.example/x.jpg" }],
      ["imageUrl IP literal", { imageUrl: "https://10.0.0.1/x.jpg" }],
      ["productName > 500", { productName: "x".repeat(600) }],
      ["productLink http", { productLink: "http://shopee.com.br/p/1" }],
      ["productLink de outro host", { productLink: "https://evil.example/p/1" }],
      ["offerLink de outro host", { offerLink: "https://evil.example/o" }],
      ["offerLink com user:pw@", { offerLink: "https://u:pw@shope.ee/o" }],
      ["priceDiscountRate 150", { priceDiscountRate: 150 }],
      ["priceDiscountRate -5", { priceDiscountRate: -5 }],
      ["priceMax < priceMin", { priceMax: 10 }],
    ];
    for (const [nome, defeito] of rejeitados) {
      it(`pula ${nome}`, async () => {
        const src = source([node({ itemId: 111, ...defeito }), node({ itemId: 222 })]);
        const r = await selectOffer({ source: src, filters: {}, history: [], now: NOW, dedupeDays: 7, groupId: "g1", ...HOSTS });
        expect(r).toMatchObject({ kind: "offer", offer: { itemId: 222 } });
      });
    }

    it("recusas anteriores do executor bloqueiam o item por 24 h (defesa em profundidade)", async () => {
      const hora = new Date(NOW.getTime() - 3_600_000);
      const hist = (status: SendHistoryRow["status"], reason: string): SendHistoryRow[] => [
        { itemId: "1", status, reason, sentAt: null, attemptedAt: hora, createdAt: hora },
      ];
      for (const h of [hist("failed", "imagem_host"), hist("failed", "link_invalido"), hist("skipped", "oferta_invalida_productUrl")]) {
        const r = await selectOffer({ source: source(), filters: {}, history: h, now: NOW, dedupeDays: 7, groupId: "g1", ...HOSTS });
        expect(r).toMatchObject({ offer: { itemId: 2 } });
      }
      // passadas 24 h o item volta a ser elegível
      const velha = new Date(NOW.getTime() - 25 * 3_600_000);
      const r = await selectOffer({
        source: source(), filters: {}, now: NOW, dedupeDays: 7, groupId: "g1", ...HOSTS,
        history: [{ itemId: "1", status: "failed", reason: "imagem_host", sentAt: null, attemptedAt: velha, createdAt: velha }],
      });
      expect(r).toMatchObject({ offer: { itemId: 1 } });
    });
  });

  it("qualquer motivo *_resultado_desconhecido bloqueia (bloqueante 2)", async () => {
    for (const reason of [
      "telegram_timeout_resultado_desconhecido",
      "telegram_transporte_resultado_desconhecido",
      "telegram_resposta_invalida_resultado_desconhecido",
      "lease_expirado_resultado_desconhecido",
    ]) {
      const h = sentOn(1, new Date(NOW.getTime() - 3_600_000), { status: "failed", reason });
      const r = await selectOffer({ source: source(), filters: {}, history: [h], now: NOW, dedupeDays: 7, groupId: "g1", ...HOSTS });
      expect(r, reason).toMatchObject({ offer: { itemId: 2 } });
    }
  });
});
