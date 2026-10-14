import { describe, expect, it } from "vitest";
import { selectOffer } from "../offer-selection.js";
import type { SendHistoryRow } from "../ports.js";
import { node } from "./helpers.js";

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
    const r = await selectOffer({ source: source(), filters: {}, history: [], now: NOW, dedupeDays: 7, groupId: "g1" });
    expect(r).toMatchObject({ kind: "offer", offer: { itemId: 1 } });
  });

  it("aplica filtros da automação (palavra-chave, preço)", async () => {
    const r = await selectOffer({ source: source(), filters: { keywords: "cabo" }, history: [], now: NOW, dedupeDays: 7, groupId: "g1" });
    expect(r).toMatchObject({ kind: "offer", offer: { itemId: 2 } });
    const caro = await selectOffer({ source: source(), filters: { priceMin: 500 }, history: [], now: NOW, dedupeDays: 7, groupId: "g1" });
    expect(caro).toEqual({ kind: "none", reason: "sem_oferta" });
  });

  it("repassa a primeira palavra-chave à Shopee e limita o tamanho da página", async () => {
    const src = source();
    await selectOffer({ source: src, filters: { keywords: ["cabo", "usb"] }, history: [], now: NOW, dedupeDays: 7, groupId: "g1" });
    expect(src.calls[0]).toMatchObject({ keyword: "cabo usb", page: 1 });
  });

  it("pula item enviado há menos de 7 dias; no dia 8 volta a poder enviar", async () => {
    const dentro = await selectOffer({ source: source(), filters: {}, history: [sentOn(1, day(6))], now: NOW, dedupeDays: 7, groupId: "g1" });
    expect(dentro).toMatchObject({ offer: { itemId: 2 } });

    const dia8 = await selectOffer({ source: source(), filters: {}, history: [sentOn(1, day(8))], now: NOW, dedupeDays: 7, groupId: "g1" });
    expect(dia8).toMatchObject({ offer: { itemId: 1 } });
  });

  it("bloqueia failed de resultado desconhecido, mas não falha limpa nem skipped (decisão 001 A5)", async () => {
    const desconhecido = sentOn(1, day(1), { status: "failed", reason: "lease_expirado_resultado_desconhecido" });
    const limpa = sentOn(1, day(1), { status: "failed", reason: "telegram_400" });
    const pulada = sentOn(1, day(1), { status: "skipped", reason: "fora_da_janela" });

    expect(await selectOffer({ source: source(), filters: {}, history: [desconhecido], now: NOW, dedupeDays: 7, groupId: "g1" })).toMatchObject({ offer: { itemId: 2 } });
    expect(await selectOffer({ source: source(), filters: {}, history: [limpa], now: NOW, dedupeDays: 7, groupId: "g1" })).toMatchObject({ offer: { itemId: 1 } });
    expect(await selectOffer({ source: source(), filters: {}, history: [pulada], now: NOW, dedupeDays: 7, groupId: "g1" })).toMatchObject({ offer: { itemId: 1 } });
  });

  it("queued e sending bloqueiam o mesmo item (evita corrida entre automações)", async () => {
    const q = sentOn(1, day(0), { status: "queued", sentAt: null, attemptedAt: null });
    expect(await selectOffer({ source: source(), filters: {}, history: [q], now: NOW, dedupeDays: 7, groupId: "g1" })).toMatchObject({ offer: { itemId: 2 } });
  });

  it("tudo repetido ⇒ none/repetida", async () => {
    const r = await selectOffer({ source: source(), filters: {}, history: [sentOn(1, day(1)), sentOn(2, day(2))], now: NOW, dedupeDays: 7, groupId: "g1" });
    expect(r).toEqual({ kind: "none", reason: "repetida" });
  });

  it("deadline total: Shopee que não responde vira erro, não trava o tick", async () => {
    const hang = { productOfferV2: () => new Promise<never>(() => {}) };
    await expect(
      selectOffer({ source: hang, filters: {}, history: [], now: NOW, dedupeDays: 7, groupId: "g1", timeoutMs: 25 }),
    ).rejects.toThrow(/timeout/i);
  });
});
