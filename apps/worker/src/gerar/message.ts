import type { ProductOfferNode } from "../scheduler-ports.js";

/** Percentual de desconto do nó da Shopee, limitado a 0..100 (o canal recusa fora disso). */
export function discountOf(offer: ProductOfferNode): number {
  const rate = offer.priceDiscountRate;
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) return 0;
  return Math.min(100, rate);
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
  const lines = [`*${title.trim()}*`, ""];
  if (priceOld > priceCurrent && discountPct > 0) {
    lines.push(`De R$ ${priceOld.toFixed(2)} por R$ ${priceCurrent.toFixed(2)} (-${discountPct}%)`);
  } else {
    lines.push(`R$ ${priceCurrent.toFixed(2)}`);
  }
  lines.push("", link);
  return lines.join("\n");
}
