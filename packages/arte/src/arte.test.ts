import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { ampliarSePreciso, baixarFoto, ErroArte, urlMelhorResolucao } from "./foto.ts";
import { gerarArte } from "./peca.ts";
import { recortarFundo } from "./recorte.ts";
import { TEMPLATE_PADRAO, templateDoNicho } from "./template.ts";

/** Produto sintético: retângulo azul com uma faixa amarela, sobre fundo branco. */
async function fotoFundoLiso(lado = 1000) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${lado}" height="${lado}">
    <rect width="100%" height="100%" fill="#ffffff"/>
    <rect x="${lado * 0.3}" y="${lado * 0.2}" width="${lado * 0.4}" height="${lado * 0.6}" rx="20" fill="#1f4fbf"/>
    <rect x="${lado * 0.3}" y="${lado * 0.45}" width="${lado * 0.4}" height="${lado * 0.1}" fill="#ffd400"/>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 95 }).toBuffer();
}

/** Foto "difícil": fundo com ruído colorido, sem cor dominante. */
async function fotoFundoRuidoso(lado = 900) {
  const raw = Buffer.alloc(lado * lado * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = Math.floor(Math.random() * 256);
  return sharp(raw, { raw: { width: lado, height: lado, channels: 3 } })
    .jpeg()
    .toBuffer();
}

describe("foto", () => {
  it("pede a maior resolução da Shopee e recusa http", () => {
    expect(urlMelhorResolucao("https://down-br.img.susercontent.com/file/abc123_tn")).toBe(
      "https://down-br.img.susercontent.com/file/abc123",
    );
    expect(urlMelhorResolucao("https://exemplo.com/a_tn")).toBe("https://exemplo.com/a_tn");
    expect(() => urlMelhorResolucao("http://down-br.img.susercontent.com/file/x")).toThrow(ErroArte);
  });

  it("baixa e confere que é imagem", async () => {
    const img = await fotoFundoLiso(300);
    const ok = (async () => new Response(img, { status: 200 })) as unknown as typeof fetch;
    const f = await baixarFoto("https://down-br.img.susercontent.com/file/x_tn", ok);
    expect(f).toMatchObject({
      url: "https://down-br.img.susercontent.com/file/x",
      largura: 300,
      altura: 300,
    });
    const html = (async () => new Response("<html>", { status: 200 })) as unknown as typeof fetch;
    await expect(baixarFoto("https://a.com/x", html)).rejects.toMatchObject({ codigo: "FOTO_INVALIDA" });
    const e404 = (async () => new Response("", { status: 404 })) as unknown as typeof fetch;
    await expect(baixarFoto("https://a.com/x", e404)).rejects.toMatchObject({ codigo: "FOTO_HTTP" });
  });

  it("amplia só abaixo de 800 px no menor lado", async () => {
    const pequena = await ampliarSePreciso(await fotoFundoLiso(400));
    expect(pequena.ampliada).toBe(true);
    expect((await sharp(pequena.buffer).metadata()).width).toBe(800);
    const grande = await ampliarSePreciso(await fotoFundoLiso(1000));
    expect(grande).toMatchObject({ ampliada: false, fator: 1 });
  });
});

describe("recorte de fundo", () => {
  it("fundo liso: separa o produto com confiança alta e caixa certa", async () => {
    const foto = await fotoFundoLiso(1000);
    const r = await recortarFundo(foto);
    expect(r.confianca).toBeGreaterThanOrEqual(0.95);
    expect(r.areaProduto).toBeGreaterThan(0.2);
    expect(r.areaProduto).toBeLessThan(0.28);
    expect(Math.abs(r.caixa.x - 300)).toBeLessThan(6);
    expect(Math.abs(r.caixa.largura - 400)).toBeLessThan(10);
    // Os pixels do produto não mudam: o centro do PNG recortado é o mesmo azul, opaco.
    const { data, info } = await sharp(r.png).raw().toBuffer({ resolveWithObject: true });
    const orig = await sharp(foto).raw().toBuffer();
    const i = (300 * info.width + 500) * info.channels;
    const j = (300 * info.width + 500) * 3;
    expect([data[i], data[i + 1], data[i + 2], data[i + 3]]).toEqual([
      orig[j],
      orig[j + 1],
      orig[j + 2],
      255,
    ]);
    // E o canto é transparente.
    expect(data[3]).toBe(0);
  });

  it("fundo ruidoso: confiança baixa", async () => {
    const r = await recortarFundo(await fotoFundoRuidoso());
    expect(r.confianca).toBeLessThan(0.5);
    expect(r.motivoBaixaConfianca).not.toBeNull();
  });
});

describe("template da bíblia", () => {
  const doc = [
    "# Templates",
    "```json",
    JSON.stringify({
      padrao: { marca: "Achadinhos da Casa" },
      nichos: { "Casa e cozinha": { cores: { destaque: "#0A7D4F" }, posicaoSelo: "superior-esquerda" } },
    }),
    "```",
  ].join("\n");

  it("junta padrão e nicho, sem diferenciar maiúsculas", () => {
    const r = templateDoNicho(doc, "casa e cozinha");
    expect(r.origem).toBe("biblia-nicho");
    expect(r.template).toMatchObject({ marca: "Achadinhos da Casa", posicaoSelo: "superior-esquerda" });
    expect(r.template.cores).toMatchObject({ destaque: "#0A7D4F", fundo: TEMPLATE_PADRAO.cores.fundo });
    expect(templateDoNicho(doc, "Outro").origem).toBe("biblia-padrao");
  });

  it("documento ausente ou inválido cai no padrão", () => {
    expect(templateDoNicho(null, "x").template).toEqual(TEMPLATE_PADRAO);
    const ruim = templateDoNicho("```json\n{ quebrado\n```", "x");
    expect(ruim.origem).toBe("padrao");
    expect(ruim.aviso).toMatch(/JSON/);
    expect(templateDoNicho('```json\n{"padrao":{"cores":{"destaque":"laranja"}}}\n```', "x").aviso).toMatch(
      /hexadecimal/,
    );
  });
});

describe("peça completa", () => {
  it("renderiza quadrado e retrato nos tamanhos certos", async () => {
    const r = await gerarArte({
      foto: await fotoFundoLiso(1000),
      formatos: ["quadrado", "retrato"],
      template: TEMPLATE_PADRAO,
      preco: 39.9,
      precoAntigo: 59.9,
      descontoPct: 33.39,
    });
    expect(r.fallback).toBe(false);
    expect(r.mascara).not.toBeNull();
    expect(r.pecas.map((p) => [p.formato, p.largura, p.altura])).toEqual([
      ["quadrado", 1080, 1080],
      ["retrato", 1080, 1350],
    ]);
    expect((await sharp(r.pecas[0]?.jpeg).metadata()).format).toBe("jpeg");
  }, 30_000);

  it("recorte ruim cai no fallback com a foto original na moldura", async () => {
    const r = await gerarArte({
      foto: await fotoFundoRuidoso(),
      formatos: ["quadrado"],
      template: TEMPLATE_PADRAO,
      preco: 19.9,
      precoAntigo: null,
      descontoPct: null,
    });
    expect(r.fallback).toBe(true);
    expect(r.motivoFallback).toMatch(/confiança/);
    expect(r.pecas).toHaveLength(1);
    const forcado = await gerarArte({
      foto: await fotoFundoLiso(900),
      formatos: ["retrato"],
      template: TEMPLATE_PADRAO,
      preco: 10,
      precoAntigo: 20,
      descontoPct: 50,
      forcarFallback: true,
    });
    expect(forcado).toMatchObject({ fallback: true, motivoFallback: "fallback forçado" });
  }, 30_000);
});
