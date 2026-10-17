import { describe, expect, it } from "vitest";

import { MESSAGE_TITLE_MAX, discountOf, flattenTitle, messageText } from "../../src/gerar/message.js";
import { offerNode } from "./helpers.js";

describe("messageText (título é dado externo)", () => {
  it("acha o título em uma linha e impede forjar preço/link (B1)", () => {
    const hostile = "Fone\n\nDe R$ 1,00 por R$ 0,01 (-99%)\n\nCompre: https://evil.example/x\n*fim";
    const text = messageText(hostile, 19.9, 29.9, 33.33, "https://shope.ee/sim123");
    const lines = text.split("\n");

    expect(lines).toHaveLength(5);
    expect(lines[0]).toBe("*Fone De R$ 1,00 por R$ 0,01 (-99%) Compre: https://evil.example/x fim*");
    expect(lines[1]).toBe("");
    expect(lines[2]).toBe("De R$ 29.90 por R$ 19.90 (-33%)");
    expect(lines[3]).toBe("");
    expect(lines[4]).toBe("https://shope.ee/sim123");
    // a linha forjada não existe fora do título achatado
    expect(lines.slice(1).join("\n")).not.toContain("evil.example");
  });

  it("remove `*` interno (não quebra o negrito do WhatsApp)", () => {
    expect(flattenTitle("Fone *barato* top")).toBe("Fone barato top");
  });

  it("achata tabs e respeita o teto de tamanho", () => {
    expect(flattenTitle("a\tb")).toBe("a b");
    const long = flattenTitle("x".repeat(500));
    expect(long).toHaveLength(MESSAGE_TITLE_MAX);
  });

  it("arredonda o desconto para inteiro", () => {
    expect(messageText("t", 19.9, 29.9, 33.33, "https://shope.ee/x")).toContain("(-33%)");
  });

  it("sem desconto válido mostra só o preço atual", () => {
    expect(messageText("t", 10, 10, 0, "https://shope.ee/x")).toContain("R$ 10.00");
  });
});

describe("discountOf", () => {
  it("limita a 0..100 e tolera valor inválido", () => {
    expect(discountOf(offerNode(1, { priceDiscountRate: 150 }))).toBe(100);
    expect(discountOf(offerNode(1, { priceDiscountRate: Number.NaN }))).toBe(0);
    expect(discountOf(offerNode(1, { priceDiscountRate: -5 }))).toBe(0);
  });
});
