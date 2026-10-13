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
