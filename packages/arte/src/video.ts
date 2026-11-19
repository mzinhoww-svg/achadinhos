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
/** Saída em 720×1280: o Instagram aceita e o ffmpeg cabe na memória do worker (as artes são desenhadas em 1080). */
const SL = 720;
const SA = 1280;
const FPS = 30;
const X264 = ["-x264-params", "rc-lookahead=10:ref=2:bframes=1"];

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
        ? `[${i}:v]scale=${SL}:${SA},zoompan=z='min(zoom+0.0009,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${quadros}:s=${SL}x${SA}:fps=${FPS},setsar=1[v${i}]`
        : `[${i}:v]scale=${SL}:${SA},setsar=1,fps=${FPS}[v${i}]`;
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
      "1",
      ...X264,
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

// ---------- Reel a partir do VÍDEO REAL da Shopee (coletado da página do produto) ----------

export interface EntradaReelVideo extends Omit<EntradaReel, "fotos"> {
  video: Buffer;
  /** Duração máxima do trecho do vídeo original (s). */
  maxTrechoS?: number;
}

async function rodar(ffmpeg: string, args: string[]) {
  return promisify(execFile)(ffmpeg, args, { maxBuffer: 20 * 1024 * 1024, timeout: 240_000 });
}

/** Lê duração e se há áudio (o ffmpeg-static não traz ffprobe: usa a saída de `ffmpeg -i`). */
async function sondar(ffmpeg: string, arquivo: string): Promise<{ duracaoS: number; temAudio: boolean }> {
  const saida = await rodar(ffmpeg, ["-hide_banner", "-i", arquivo]).catch((e: { stderr?: string }) => ({
    stderr: e.stderr ?? "",
  }));
  const txt = String((saida as { stderr?: string }).stderr ?? "");
  const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(txt);
  const duracaoS = m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
  return { duracaoS, temAudio: /Stream #\d+:\d+.*Audio:/.test(txt) };
}

function camadaSobreVideo(e: EntradaReel, c: (typeof CORES)[ModeloReel], comGancho: boolean): No {
  const caixa = (texto: string, tamanho: number, inverso: boolean) =>
    h(
      "div",
      {
        display: "flex",
        padding: "20px 34px",
        borderRadius: 26,
        backgroundColor: inverso ? c.destaque : "rgba(255,255,255,0.94)",
        color: inverso ? c.textoDestaque : "#111111",
        fontSize: tamanho,
        fontWeight: 800,
        lineHeight: 1.15,
        textAlign: "center",
        justifyContent: "center",
        maxWidth: 960,
      },
      texto,
    );
  return h(
    "div",
    {
      width: L,
      height: A,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "space-between",
      fontFamily: "Inter",
    },
    h(
      "div",
      { display: "flex", marginTop: 140 },
      comGancho ? caixa(e.gancho ?? GANCHO[e.modelo](e), 68, true) : null,
    ),
    h(
      "div",
      { display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 210 },
      e.precoAntigo
        ? h(
            "div",
            {
              display: "flex",
              fontSize: 44,
              color: c.texto,
              opacity: 0.75,
              textDecoration: "line-through",
              marginBottom: 8,
            },
            `De ${formatarPreco(e.precoAntigo)}`,
          )
        : null,
      caixa(
        `${formatarPreco(e.preco)}${e.descontoPct ? ` · −${Math.round(e.descontoPct)}%` : ""}`,
        64,
        false,
      ),
    ),
  );
}

/**
 * Reel com o vídeo oficial do produto: trecho de até 12 s enquadrado em 1080×1920 (sem cortar o produto),
 * gancho nos primeiros 2,5 s, preço embaixo e o cartão final "Comente PALAVRA" (3,5 s). Mantém o áudio original.
 */
export async function gerarReelDeVideo(e: EntradaReelVideo, binario?: string): Promise<ReelGerado> {
  const c = CORES[e.modelo];
  const ffmpeg = binario ?? (createRequire(import.meta.url)("ffmpeg-static") as string);
  const pasta = await mkdtemp(join(tmpdir(), "reelv-"));
  try {
    const entrada = join(pasta, "original.mp4");
    await writeFile(entrada, e.video);
    const info = await sondar(ffmpeg, entrada);
    if (!info.duracaoS) throw new Error("não foi possível ler o vídeo");
    const trecho = Math.min(info.duracaoS, e.maxTrechoS ?? 12);
    const cartao = 3.5;
    await writeFile(
      join(pasta, "gancho.png"),
      await svgParaPng(camadaSobreVideo({ ...e, fotos: [] }, c, true)),
    );
    await writeFile(
      join(pasta, "preco.png"),
      await svgParaPng(camadaSobreVideo({ ...e, fotos: [] }, c, false)),
    );
    await writeFile(join(pasta, "cta.png"), await svgParaPng(camadaTexto({ ...e, fotos: [] }, c, "cta")));
    const filtro = [
      // vídeo original inteiro dentro do quadro vertical, com faixas na cor do modelo
      `[0:v]trim=0:${trecho},setpts=PTS-STARTPTS,scale=${SL}:${SA}:force_original_aspect_ratio=decrease,pad=${SL}:${SA}:(ow-iw)/2:(oh-ih)/2:color=${c.fundo.replace("#", "0x")},fps=${FPS},setsar=1[base]`,
      `[1:v]scale=${SL}:${SA}[o1]`,
      `[2:v]scale=${SL}:${SA}[o2]`,
      `[base][o1]overlay=0:0:enable='lt(t,2.5)'[g]`,
      `[g][o2]overlay=0:0:enable='gte(t,2.5)'[vid]`,
      `[3:v]scale=${SL}:${SA},setsar=1,fps=${FPS}[fim]`,
      info.temAudio
        ? `[0:a]atrim=0:${trecho},asetpts=PTS-STARTPTS,aresample=44100[a0]`
        : `[4:a]atrim=0:${trecho}[a0]`,
      `[4:a]atrim=0:${cartao},asetpts=PTS-STARTPTS[a1]`,
      `[vid][a0][fim][a1]concat=n=2:v=1:a=1[cv][a]`,
      `[cv]format=yuv420p[v]`,
    ].join(";");
    await rodar(ffmpeg, [
      "-y",
      "-loglevel",
      "error",
      "-i",
      entrada,
      "-i",
      join(pasta, "gancho.png"),
      "-i",
      join(pasta, "preco.png"),
      "-loop",
      "1",
      "-framerate",
      String(FPS),
      "-t",
      String(cartao),
      "-i",
      join(pasta, "cta.png"),
      "-f",
      "lavfi",
      "-t",
      String(trecho + cartao),
      "-i",
      "anullsrc=channel_layout=stereo:sample_rate=44100",
      "-filter_complex",
      filtro,
      "-map",
      "[v]",
      "-map",
      "[a]",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-threads",
      "1",
      ...X264,
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      join(pasta, "reel.mp4"),
    ]);
    // capa: um quadro do vídeo com o gancho
    await rodar(ffmpeg, [
      "-y",
      "-loglevel",
      "error",
      "-ss",
      "1",
      "-i",
      join(pasta, "reel.mp4"),
      "-frames:v",
      "1",
      join(pasta, "capa.jpg"),
    ]);
    return {
      mp4: await readFile(join(pasta, "reel.mp4")),
      capa: await readFile(join(pasta, "capa.jpg")),
      duracaoS: trecho + cartao,
      modelo: e.modelo,
    };
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
}
