import type { ProductOfferNode } from "../scheduler-ports.js";

/** Teto do título na mensagem pronta para copiar. */
export const MESSAGE_TITLE_MAX = 120;

/** Percentual de desconto do nó da Shopee, limitado a 0..100 (o canal recusa fora disso). */
export function discountOf(offer: ProductOfferNode): number {
  const rate = offer.priceDiscountRate;
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) return 0;
  return Math.min(100, rate);
}

/**
 * Título é dado externo: vira UMA linha (`\s+` → espaço), sem `*` interno (senão quebra o negrito do
 * WhatsApp) e com teto de tamanho. Sem isso, um título com quebra de linha forjaria preço/link na
 * mensagem pronta para copiar (o `text` do canal preserva `\n`).
 */
export function flattenTitle(title: string): string {
  return title
    .replace(/\s+/g, " ")
    .replace(/\*/g, "")
    .trim()
    .slice(0, MESSAGE_TITLE_MAX)
    .trim();
}

/**
 * Mensagem pronta para copiar (vai no bloco cercado do `.md`, sem escape de markdown). Usa `*negrito*`,
 * que é o marcador do WhatsApp; o `link` já é o encurtado e validado.
 */
export function messageText(
  title: string,
  priceCurrent: number,
  priceOld: number,
  discountPct: number,
  link: string,
): string {
  const lines = [`*${flattenTitle(title)}*`, ""];
  const rounded = Math.round(discountPct);
  if (priceOld > priceCurrent && rounded > 0) {
    lines.push(`De R$ ${priceOld.toFixed(2)} por R$ ${priceCurrent.toFixed(2)} (-${rounded}%)`);
  } else {
    lines.push(`R$ ${priceCurrent.toFixed(2)}`);
  }
  lines.push("", link);
  return lines.join("\n");
}
