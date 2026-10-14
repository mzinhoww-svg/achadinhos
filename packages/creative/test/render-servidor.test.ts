import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CreativeError } from "../src/image.ts";
import { renderOfferCreative, type OfferCreativeInput } from "../src/render.ts";
import { diffRatio, decodePng, productPng } from "./helpers.ts";

const img = productPng(340, "FONE");
const deps = { fetchImage: async () => ({ bytes: img, mime: "image/png" as const, width: 800, height: 800 }) };
const base: OfferCreativeInput = {
  title: "Fone de ouvido Bluetooth com cancelamento de ruído e estojo carregador",
  imageUrl: "https://down-br.img.susercontent.com/file/abc",
  priceCurrent: 99.9,
  priceOld: 189.9,
  affiliateHandle: "@achadinhos.demo",
};

const FIXTURES: Record<string, OfferCreativeInput> = {
  normal: base,
  "nome-longo-300": { ...base, title: "Fone de ouvido Bluetooth esportivo à prova d'água com cancelamento de ruído ativo e bateria de longa duração ".repeat(3) },
  "preco-10mil": { ...base, title: "Notebook gamer 16GB 1TB SSD", priceCurrent: 12999.9, priceOld: 15999.9 },
  "preco-100mil": { ...base, title: "Moto elétrica", priceCurrent: 99999.99, priceOld: 129999.99 },
  "sem-desconto": { ...base, priceOld: 99.9 },
  "preco-antigo-ausente": { ...base, priceOld: undefined },
  emoji: { ...base, title: "🔥😀 Fone ✨ 日本語 Bluetooth 🎧" },
  "handle-longo": { ...base, affiliateHandle: "@" + "afiliado.com.nome.muito.longo".repeat(4) },
  "titulo-sem-espacos": { ...base, title: "A".repeat(300) },
};

describe("renderOfferCreative", () => {
  it.each(Object.keys(FIXTURES))("gera PNG 1080x1080 — %s", async (name) => {
    const png = await renderOfferCreative(FIXTURES[name]!, deps);
    expect(Buffer.from(png.slice(0, 8)).toString("hex")).toBe("89504e470d0a1a0a");
    const { width, height } = decodePng(png);
    expect([width, height]).toEqual([1080, 1080]);
  });

  it("imagem ausente/indisponível: falha fechada (nunca placeholder)", async () => {
    const failing = { fetchImage: async () => { throw new CreativeError("network", "sem rede"); } };
    await expect(renderOfferCreative(base, failing)).rejects.toMatchObject({ code: "network" });
    await expect(renderOfferCreative({ ...base, imageUrl: "" }, deps)).rejects.toMatchObject({ code: "image_missing" });
  });
  it.each([
    ["preço negativo", { priceCurrent: -1 }],
    ["preço NaN", { priceCurrent: Number.NaN }],
    ["preço infinito", { priceCurrent: Number.POSITIVE_INFINITY }],
    ["preço zero", { priceCurrent: 0 }],
    ["handle vazio", { affiliateHandle: "  " }],
  ])("entrada inválida falha fechada: %s", async (_n, patch) => {
    await expect(renderOfferCreative({ ...base, ...patch } as OfferCreativeInput, deps)).rejects.toMatchObject({ code: "invalid_input" });
  });
  it("título é limitado a 300 caracteres e título vazio vira 'Oferta'", async () => {
    const a = await renderOfferCreative({ ...base, title: "x".repeat(5000) }, deps);
    const b = await renderOfferCreative({ ...base, title: "x".repeat(300) }, deps);
    expect(diffRatio(a, b)).toBe(0);
    await expect(renderOfferCreative({ ...base, title: "🔥🔥" }, deps)).resolves.toBeDefined();
  });
  it("determinístico", async () => {
    const [a, b] = [await renderOfferCreative(base, deps), await renderOfferCreative(base, deps)];
    expect(diffRatio(a, b)).toBe(0);
  });
  it("respeita timeout de render", async () => {
    const slow = { fetchImage: () => new Promise<never>(() => {}) };
    await expect(renderOfferCreative(base, slow, { timeoutMs: 100 })).rejects.toMatchObject({ code: "timeout" });
  });
});

describe("snapshot PNG por fixture (tolerância de pixel)", () => {
  const dir = new URL("./__snapshots__/", import.meta.url);
  const update = process.env.UPDATE_SNAPSHOTS === "1";
  it.each(Object.keys(FIXTURES))("%s", async (name) => {
    const png = await renderOfferCreative(FIXTURES[name]!, deps);
    const file = new URL(`${name}.png`, dir);
    if (update || !existsSync(file)) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, png);
      if (!update) console.warn(`snapshot criado: ${name}`);
      return;
    }
    const ratio = diffRatio(png, readFileSync(file));
    if (ratio >= 0.002) {
      const A = decodePng(png), B = decodePng(readFileSync(file));
      let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1, maxD = 0;
      for (let i = 0; i < A.rgba.length; i += 4) {
        const d = Math.max(Math.abs(A.rgba[i]! - B.rgba[i]!), Math.abs(A.rgba[i + 1]! - B.rgba[i + 1]!), Math.abs(A.rgba[i + 2]! - B.rgba[i + 2]!));
        if (d > 12) { const p = i / 4, x = p % 1080, y = (p / 1080) | 0; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); maxD = Math.max(maxD, d); }
      }
      console.log(`DIFFDEBUG ${name} ratio=${ratio} bbox=${minX},${minY}-${maxX},${maxY} maxDelta=${maxD}`);
    }
    expect(ratio).toBeLessThan(0.002);
  });
});
