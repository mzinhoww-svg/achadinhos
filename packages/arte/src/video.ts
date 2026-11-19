import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Resvg } from "@resvg/resvg-js";
import satori from "satori";
import sharp from "sharp";
import { carregarFontes, formatarPreco } from "./template.ts";

/**
 * Diretor de Vídeo: Reels verticais (1080×1920, 30 fps, ~15 s) feitos só com as FOTOS REAIS do produto.
 * O produto nunca é alterado: as fotos entram inteiras (contain) e o movimento é só zoom/pan da câmera.
 * Estrutura: gancho (2,5 s) → fotos com zoom (2 s cada, até 4) → preço → chamada "Comente PALAVRA".
 * Cada modelo muda cores, gancho e ritmo, para testar o que converte mais.
 */

export type ModeloReel = "classico" | "minimal" | "impacto";
export const MODELOS_REEL: ModeloReel[] = ["classico", "minimal", "impacto"];

export interface EntradaReel {
  fotos: Buffer[];
  titulo: string;
  preco: number;
  /** Só quando o desconto é real (mediana de 30 dias); senão null. */
  precoAntigo: number | null;
  descontoPct: number | null;
  palavra: string;
  marca: string;
  modelo: ModeloReel;
  /** Frase do gancho; sem ela, usa a do modelo. */
  gancho?: string;
}

const L = 1080;
const A = 1920;
const FPS = 30;

const CORES: Record<
  ModeloReel,
  { fundo: string; texto: string; destaque: string; textoDestaque: string; cartao: string }
> = {
  classico: {
    fundo: "#FFF3EA",
    texto: "#1F1F1F",
    destaque: "#E85D04",
    textoDestaque: "#FFFFFF",
    cartao: "#FFFFFF",
  },
  minimal: {
    fundo: "#FFFFFF",
    texto: "#111111",
    destaque: "#111111",
    textoDestaque: "#FFFFFF",
    cartao: "#F4F4F4",
  },
  impacto: {
    fundo: "#111111",
    texto: "#FFFFFF",
    destaque: "#FFD400",
    textoDestaque: "#111111",
    cartao: "#1E1E1E",
  },
};

const GANCHO: Record<ModeloReel, (e: EntradaReel) => string> = {
  classico: (e) =>
    e.descontoPct ? `Achei isso ${Math.round(e.descontoPct)}% mais barato` : "Achado de casa que vale a pena",
  minimal: () => "Você precisa disso na sua casa",
  impacto: (e) => `Só ${formatarPreco(e.preco)}?`,
};

type No = { type: string; key: null; props: Record<string, unknown> };
const h = (type: string, style: Record<string, unknown>, ...children: (No | string | null)[]): No => ({
  type,
  key: null,
  props: { style, children: children.filter((c) => c !== null) },
});

async function svgParaPng(no: No): Promise<Buffer> {
  // biome-ignore lint/suspicious/noExplicitAny: formato de elemento aceito pelo Satori
  const svg = await satori(no as any, { width: L, height: A, fonts: carregarFontes() });
  return Buffer.from(
    new Resvg(svg, { fitTo: { mode: "original" }, font: { loadSystemFonts: false } }).render().asPng(),
  );
}

/** Foto inteira (sem corte nem alteração) sobre o fundo do modelo, com margem para o texto. */
async function cenaFoto(foto: Buffer, fundo: string, alturaUtil = 1300, topo = 360): Promise<Buffer> {
  const ajustada = await sharp(foto)
    .rotate()
    .resize(L - 120, alturaUtil, { fit: "contain", background: fundo })
    .flatten({ background: fundo })
    .png()
    .toBuffer();
  return sharp({ create: { width: L, height: A, channels: 3, background: fundo } })
    .composite([{ input: ajustada, left: 60, top: topo }])
    .png()
    .toBuffer();
}

async function sobrepor(base: Buffer, camada: No): Promise<Buffer> {
  return sharp(base)
    .composite([{ input: await svgParaPng(camada) }])
    .png()
    .toBuffer();
}

function camadaTexto(
  e: EntradaReel,
  c: (typeof CORES)[ModeloReel],
  tipo: "gancho" | "fotos" | "preco" | "cta",
): No {
  const caixa = (texto: string, tamanho: number, inverso = false) =>
    h(
      "div",
      {
        display: "flex",
        padding: "22px 36px",
        borderRadius: 28,
        backgroundColor: inverso ? c.destaque : c.cartao,
        color: inverso ? c.textoDestaque : c.texto,
        fontSize: tamanho,
        fontWeight: 800,
        lineHeight: 1.15,
        textAlign: "center",
        justifyContent: "center",
        maxWidth: 960,
      },
      texto,
    );
  const base = {
    width: L,
    height: A,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    fontFamily: "Inter",
  };
  const marca = h(
    "div",
    { display: "flex", marginTop: 90, fontSize: 34, fontWeight: 800, color: c.destaque },
    e.marca,
  );
  if (tipo === "gancho")
    return h(
      "div",
      base,
      marca,
      h("div", { display: "flex", marginTop: 60 }, caixa(e.gancho ?? GANCHO[e.modelo](e), 76, true)),
    );
  if (tipo === "fotos")
    return h(
      "div",
      { ...base, justifyContent: "space-between" },
      marca,
      h(
        "div",
        { display: "flex", marginBottom: 120 },
        caixa(e.titulo.length > 60 ? `${e.titulo.slice(0, 57)}…` : e.titulo, 46),
      ),
    );
  if (tipo === "preco")
    return h(
      "div",
      { ...base, justifyContent: "center", backgroundColor: c.fundo },
      e.precoAntigo
        ? h(
            "div",
            { display: "flex", fontSize: 64, color: c.texto, opacity: 0.6, textDecoration: "line-through" },
            `De ${formatarPreco(e.precoAntigo)}`,
          )
        : null,
      h(
        "div",
        { display: "flex", fontSize: 150, fontWeight: 800, color: c.texto, letterSpacing: -4 },
        formatarPreco(e.preco),
      ),
      e.descontoPct
        ? h(
            "div",
            { display: "flex", marginTop: 30 },
            caixa(`${Math.round(e.descontoPct)}% abaixo do preço médio`, 52, true),
          )
        : null,
    );
  return h(
    "div",
    { ...base, justifyContent: "center", backgroundColor: c.fundo },
    h("div", { display: "flex", fontSize: 60, fontWeight: 700, color: c.texto }, "Quer o link?"),
    h("div", { display: "flex", fontSize: 60, fontWeight: 700, color: c.texto, marginTop: 10 }, "Comente"),
    h("div", { display: "flex", marginTop: 40 }, caixa(e.palavra.toUpperCase(), 140, true)),
    h(
      "div",
      { display: "flex", fontSize: 44, color: c.texto, marginTop: 50, textAlign: "center", maxWidth: 900 },
      "que eu te mando no direct, junto com o grupo de ofertas",
    ),
    h(
      "div",
      { display: "flex", fontSize: 28, color: c.texto, opacity: 0.6, marginTop: 60 },
      "#publi · link de afiliado",
    ),
  );
}

export interface ReelGerado {
  mp4: Buffer;
  capa: Buffer;
  duracaoS: number;
  modelo: ModeloReel;
}

/** Monta as cenas e codifica o MP4 com o ffmpeg empacotado (ffmpeg-static). */
export async function gerarReel(e: EntradaReel, binario?: string): Promise<ReelGerado> {
  if (!e.fotos.length) throw new Error("o Reel precisa de pelo menos uma foto real");
  const c = CORES[e.modelo];
  const fotos = e.fotos.slice(0, 4);
  const cenas: { png: Buffer; dur: number; zoom: boolean }[] = [];
  const primeira = await cenaFoto(fotos[0] as Buffer, c.fundo, 1150, 560);
  cenas.push({ png: await sobrepor(primeira, camadaTexto(e, c, "gancho")), dur: 2.5, zoom: true });
  for (const f of fotos)
    cenas.push({
      png: await sobrepor(await cenaFoto(f, c.fundo), camadaTexto(e, c, "fotos")),
      dur: e.modelo === "impacto" ? 1.6 : 2.2,
      zoom: true,
    });
  cenas.push({ png: await svgParaPng(camadaTexto(e, c, "preco")), dur: 2.5, zoom: false });
  cenas.push({ png: await svgParaPng(camadaTexto(e, c, "cta")), dur: 3.5, zoom: false });

  const ffmpeg = binario ?? (createRequire(import.meta.url)("ffmpeg-static") as string);
  const pasta = await mkdtemp(join(tmpdir(), "reel-"));
  try {
    const args: string[] = ["-y", "-loglevel", "error"];
    for (const [i, cena] of cenas.entries()) {
      await writeFile(join(pasta, `c${i}.png`), cena.png);
      // Cena com zoom: uma imagem só (o zoompan gera os quadros); cena parada: imagem em loop pelo tempo da cena.
      if (cena.zoom) args.push("-i", join(pasta, `c${i}.png`));
      else
        args.push(
          "-loop",
          "1",
          "-framerate",
          String(FPS),
          "-t",
          String(cena.dur),
          "-i",
          join(pasta, `c${i}.png`),
        );
    }
    // Zoom lento só da câmera (o produto não muda); depois concatena as cenas.
    const filtros = cenas.map((cena, i) => {
      const quadros = Math.round(cena.dur * FPS);
      return cena.zoom
        ? `[${i}:v]scale=${L * 2}:${A * 2},zoompan=z='min(zoom+0.0009,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${quadros}:s=${L}x${A}:fps=${FPS},setsar=1[v${i}]`
        : `[${i}:v]scale=${L}:${A},setsar=1,fps=${FPS}[v${i}]`;
    });
    const total = cenas.reduce((a, x) => a + x.dur, 0);
    args.push(
      "-filter_complex",
      `${filtros.join(";")};${cenas.map((_, i) => `[v${i}]`).join("")}concat=n=${cenas.length}:v=1:a=0,format=yuv420p[saida]`,
      "-map",
      "[saida]",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-threads",
      "2",
      "-movflags",
      "+faststart",
      "-t",
      String(total),
      join(pasta, "reel.mp4"),
    );
    await promisify(execFile)(ffmpeg, args, { maxBuffer: 10 * 1024 * 1024, timeout: 180_000 });
    const capa = await sharp(cenas[0]?.png as Buffer)
      .jpeg({ quality: 88 })
      .toBuffer();
    return { mp4: await readFile(join(pasta, "reel.mp4")), capa, duracaoS: total, modelo: e.modelo };
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
}
