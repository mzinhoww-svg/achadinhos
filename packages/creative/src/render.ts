import { readFileSync } from "node:fs";
import { createElement } from "react";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { Creative, type CreativeProps } from "./Creative.tsx";
import { CREATIVE_SIZE, fontFamily } from "./tokens.ts";
import { CreativeError, fetchProductImage, type FetchedImage } from "./image.ts";
import { discountPct } from "./format.ts";
import { hasDiscount, sanitizeTitle } from "./layout.ts";

const fontFile = (name: string) => readFileSync(new URL(`../fonts/${name}`, import.meta.url));

type Weight = 400 | 600 | 700 | 800;
let fonts: { name: string; data: Buffer; weight: Weight; style: "normal" }[] | undefined;
function loadFonts() {
  fonts ??= [
    { name: fontFamily.text, data: fontFile("figtree-latin-400-normal.woff"), weight: 400, style: "normal" },
    { name: fontFamily.text, data: fontFile("figtree-latin-600-normal.woff"), weight: 600, style: "normal" },
    { name: fontFamily.text, data: fontFile("figtree-latin-700-normal.woff"), weight: 700, style: "normal" },
    { name: fontFamily.display, data: fontFile("bricolage-grotesque-latin-700-normal.woff"), weight: 700, style: "normal" },
    { name: fontFamily.display, data: fontFile("bricolage-grotesque-latin-800-normal.woff"), weight: 800, style: "normal" },
  ];
  return fonts;
}

/** JSX -> SVG (Satori) -> PNG 1080x1080 (Resvg). Determinístico: fontes vêm do repo. */
export async function renderCreativeSvg(props: CreativeProps): Promise<string> {
  return satori(createElement(Creative, props), { width: CREATIVE_SIZE, height: CREATIVE_SIZE, fonts: loadFonts() });
}

export async function renderCreativePng(props: CreativeProps): Promise<Uint8Array> {
  const svg = await renderCreativeSvg(props);
  return new Resvg(svg, { fitTo: { mode: "width", value: CREATIVE_SIZE } }).render().asPng();
}

export interface OfferCreativeInput {
  title: string;
  /** URL https da foto no CDN da Shopee (baixada com limites) */
  imageUrl: string;
  priceCurrent: number;
  priceOld?: number | undefined;
  affiliateHandle: string;
}
export interface OfferCreativeDeps {
  fetchImage?: (url: string) => Promise<FetchedImage>;
}

const TITLE_MAX = 300;
const HANDLE_MAX = 64;

/**
 * Criativo final do envio: baixa a foto com limites, valida a entrada e renderiza o PNG 1080x1080 no servidor.
 * Falha fechada: sem imagem válida ou com preço inválido NÃO há placeholder; o chamador marca o envio como `failed`.
 * `timeoutMs` cobre download + render (decisão 002 C4).
 */
export async function renderOfferCreative(
  input: OfferCreativeInput,
  deps: OfferCreativeDeps = {},
  opts: { timeoutMs?: number } = {},
): Promise<Uint8Array> {
  const { priceCurrent } = input;
  if (!Number.isFinite(priceCurrent) || priceCurrent <= 0 || priceCurrent >= 100_000_000) {
    throw new CreativeError("invalid_input", "Preço atual inválido.");
  }
  const priceOld = typeof input.priceOld === "number" && Number.isFinite(input.priceOld) && input.priceOld > 0 ? input.priceOld : 0;
  const handle = input.affiliateHandle.replace(/[^A-Za-z0-9._@-]/g, "").replace(/^@+/, "").slice(0, HANDLE_MAX);
  if (!handle) throw new CreativeError("invalid_input", "@ do afiliado inválido.");
  if (!input.imageUrl?.trim()) throw new CreativeError("image_missing", "Oferta sem imagem.");

  const fetchImage = deps.fetchImage ?? ((u: string) => fetchProductImage(u));
  const timeoutMs = opts.timeoutMs ?? 15_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new CreativeError("timeout", "Tempo esgotado ao gerar o criativo.")), timeoutMs);
  });
  const work = async () => {
    const img = await fetchImage(input.imageUrl);
    const dataUri = `data:${img.mime};base64,${Buffer.from(img.bytes).toString("base64")}`;
    try {
      return await renderCreativePng({
        title: sanitizeTitle(input.title).slice(0, TITLE_MAX),
        imageUrl: dataUri,
        priceCurrent,
        priceOld,
        discountPct: hasDiscount(priceCurrent, priceOld) ? discountPct(priceCurrent, priceOld) : 0,
        affiliateHandle: handle,
      });
    } catch (e) {
      if (e instanceof CreativeError) throw e;
      throw new CreativeError("render", "Falha ao renderizar o criativo.");
    }
  };
  try {
    return await Promise.race([work(), deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
