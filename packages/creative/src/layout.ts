import { formatBRL } from "./format.ts";

/** Largura útil do conteúdo do criativo (1080 − 2×48). */
const CONTENT_WIDTH = 984;
const GAP = 28;
/** Largura média de um glifo (em em) nas fontes do criativo, com folga: números ficam sempre dentro da área. */
const EM_CURRENT = 0.62;
const EM_OLD = 0.6;
export const PRICE_FONT_MAX = 116;
export const PRICE_FONT_MIN = 56;
export const OLD_PRICE_FONT = 42;

/** Selo e preço riscado só fazem sentido quando o preço antigo é maior que o atual. */
export function hasDiscount(priceCurrent: number, priceOld: number): boolean {
  return priceOld > priceCurrent && priceCurrent >= 0;
}

/** Fonte do preço atual: reduz até caber na linha junto do preço antigo (sem quebra de linha). */
export function priceLayout(priceCurrent: number, priceOld: number) {
  const oldWidth = hasDiscount(priceCurrent, priceOld)
    ? formatBRL(priceOld).length * OLD_PRICE_FONT * EM_OLD + GAP
    : 0;
  const fit = Math.floor((CONTENT_WIDTH - oldWidth) / (formatBRL(priceCurrent).length * EM_CURRENT));
  return { currentFont: Math.max(PRICE_FONT_MIN, Math.min(PRICE_FONT_MAX, fit)), showOld: oldWidth > 0 };
}

/**
 * As fontes embutidas são só latin (Satori não troca de fonte sozinho): emoji e CJK viram caixas vazias.
 * Mantém latim + pontuação geral + € e ™; o resto sai e os espaços são normalizados.
 */
export function sanitizeTitle(title: string): string {
  const clean = title
    .replace(/[^ -ɏ‐-‧‰-›€™]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return clean || "Oferta";
}
