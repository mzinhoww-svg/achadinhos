import { describe, expect, it } from "vitest";
import { renderCreativePng, renderCreativeSvg } from "../src/render.ts";
import { productPlaceholder } from "../src/placeholder.ts";
import { discountPct, formatBRL } from "../src/format.ts";

const base = {
  title: "Fone Bluetooth",
  imageUrl: productPlaceholder(200, "X"),
  priceCurrent: 99.9,
  priceOld: 189.9,
  discountPct: 47,
  affiliateHandle: "achadinhos.demo",
};

describe("formatBRL / discountPct", () => {
  it("formata em pt-BR sem Intl", () => {
    expect(formatBRL(99.9)).toBe("R$ 99,90");
    expect(formatBRL(1234.5)).toBe("R$ 1.234,50");
    expect(formatBRL(0.05)).toBe("R$ 0,05");
  });
  it("calcula desconto", () => {
    expect(discountPct(99.9, 189.9)).toBe(47);
    expect(discountPct(10, 10)).toBe(0);
  });
});

describe("criativo", () => {
  it("renderiza PNG 1080x1080", async () => {
    const png = await renderCreativePng(base);
    expect(Buffer.from(png.slice(0, 8)).toString("hex")).toBe("89504e470d0a1a0a");
    const view = new DataView(png.buffer, png.byteOffset);
    expect(view.getUint32(16)).toBe(1080);
    expect(view.getUint32(20)).toBe(1080);
  });
  it("SVG contém preço, selo e @ do afiliado (texto vira path; confere viewBox)", async () => {
    const svg = await renderCreativeSvg(base);
    expect(svg).toContain('viewBox="0 0 1080 1080"');
  });
  it("é determinístico", async () => {
    expect(await renderCreativeSvg(base)).toBe(await renderCreativeSvg(base));
  });
});

import { Resvg } from "@resvg/resvg-js";
import { Creative } from "../src/Creative.tsx";
import { hasDiscount, priceLayout, sanitizeTitle } from "../src/layout.ts";
import { palette } from "../src/tokens.ts";

function texts(node: unknown, out: string[] = []): string[] {
  if (typeof node === "string" || typeof node === "number") out.push(String(node));
  else if (Array.isArray(node)) node.forEach((n) => texts(n, out));
  else if (node && typeof node === "object" && "props" in node) texts((node as { props: { children?: unknown } }).props.children, out);
  return out;
}
async function footerPixel(props: Parameters<typeof renderCreativeSvg>[0]) {
  const img = new Resvg(await renderCreativeSvg(props)).render();
  const i = (990 * img.width + 5) * 4; // dentro do rodapé (topo em y=984)
  return `#${[0, 1, 2].map((k) => img.pixels[i + k]!.toString(16).padStart(2, "0")).join("")}`;
}

describe("criativo com dados extremos (QA ciclo 1)", () => {
  it("preço ≥ R$ 10.000 não quebra linha nem empurra o rodapé", async () => {
    const big = { ...base, priceCurrent: 12999.9, priceOld: 15999.9, discountPct: 19 };
    const lay = priceLayout(big.priceCurrent, big.priceOld);
    expect(lay.currentFont).toBeLessThan(116);
    expect(lay.currentFont).toBeGreaterThanOrEqual(56);
    expect(await footerPixel(big)).toBe(palette.plum600);
  });
  it("preço absurdo mantém o rodapé", async () => {
    const huge = { ...base, priceCurrent: 999999.99, priceOld: 1999999.99, discountPct: 50 };
    expect(await footerPixel(huge)).toBe(palette.plum600);
  });
  it("título com emoji/CJK é saneado (fontes são só latin)", () => {
    expect(sanitizeTitle("🔥😀 Fone ✨ 日本語 Bluetooth")).toBe("Fone Bluetooth");
    expect(sanitizeTitle("Café com leite — 500 ml™")).toBe("Café com leite — 500 ml™");
    expect(sanitizeTitle("🔥🔥")).toBe("Oferta");
    const all = texts(Creative({ ...base, title: "🔥😀 Fone 日本語" })).join("|");
    expect(all).not.toMatch(/[\u{1F300}-\u{1FAFF}぀-鿿]/u);
  });
  it("sem desconto: não desenha selo '-0% OFF' nem preço antigo riscado", () => {
    expect(hasDiscount(99.9, 0)).toBe(false);
    expect(hasDiscount(99.9, 99.9)).toBe(false);
    expect(hasDiscount(99.9, 189.9)).toBe(true);
    for (const priceOld of [0, 99.9]) {
      const all = texts(Creative({ ...base, priceOld, discountPct: 0 })).join("|");
      expect(all).not.toContain("-0%");
      expect(all).not.toContain("OFF");
      expect(all).not.toContain("R$ 0,00");
    }
  });
  it("título de 300 caracteres renderiza e mantém o rodapé", async () => {
    expect(await footerPixel({ ...base, title: "Fone ".repeat(60) })).toBe(palette.plum600);
    expect(await footerPixel({ ...base, title: "A".repeat(300) })).toBe(palette.plum600);
  });
});
