/**
 * Critério ÚNICO de "oferta enviável", compartilhado entre a seleção (T7-05) e o
 * executor (T7-06). Dois validadores independentes deixavam a seleção escolher
 * ofertas que o executor recusa, e a recusa não entra na antirrepetição.
 */

/** Hosts de afiliado/produto da Shopee (decisão 004). */
export const DEFAULT_SHOPEE_LINK_HOSTS = ["shopee.com.br", "shp.ee", "shope.ee", "s.shopee.com.br"];
export const MAX_LINK_LENGTH = 300;
export const MAX_URL_LENGTH = 2000;
export const MAX_TITLE_LENGTH = 500;

/** https, sem credenciais embutidas, host exato ou subdomínio de um host permitido, tamanho limitado. */
export function isAllowedLink(raw: unknown, hosts: readonly string[], maxLength = MAX_LINK_LENGTH): boolean {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > maxLength || raw !== raw.trim()) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return hosts.some((h) => host === h || host.endsWith(`.${h}`));
}

export function isHttpsUrl(raw: unknown, maxLength = MAX_URL_LENGTH): boolean {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > maxLength) return false;
  try {
    return new URL(raw).protocol === "https:";
  } catch {
    return false;
  }
}

/** Mesma regra do download da imagem (decisão 002 C1): https, sem IP literal, host na allowlist. Sem `node:net` para o pacote seguir utilizável no navegador. */
export function isAllowedImageUrl(raw: unknown, hosts: readonly string[]): boolean {
  if (!isHttpsUrl(raw)) return false;
  const host = new URL(raw as string).hostname.toLowerCase();
  // WHATWG URL normaliza IPv4 (hex/decimal) para dotted-decimal e IPv6 vem entre colchetes
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.startsWith("[")) return false;
  return hosts.some((h) => host === h || host.endsWith(`.${h}`));
}

export type SendableOffer = {
  title: unknown;
  priceCurrent: unknown;
  priceOld: unknown;
  discountPct: unknown;
  productUrl: unknown;
  imageUrl: unknown;
};

/** Nome do primeiro campo inválido (mesmos nomes de `oferta_invalida_<campo>` do executor), ou undefined. */
export function sendableOfferField(
  o: SendableOffer,
  opts: { linkHosts?: readonly string[]; imageHosts: readonly string[] },
): string | undefined {
  const linkHosts = opts.linkHosts ?? DEFAULT_SHOPEE_LINK_HOSTS;
  const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
  if (typeof o.title !== "string" || o.title.trim() === "" || o.title.length > MAX_TITLE_LENGTH) return "title";
  if (!num(o.priceCurrent) || o.priceCurrent <= 0) return "priceCurrent";
  if (!num(o.priceOld) || o.priceOld < o.priceCurrent) return "priceOld";
  if (!num(o.discountPct) || o.discountPct < 0 || o.discountPct > 100) return "discountPct";
  if (!isAllowedLink(o.productUrl, linkHosts)) return "productUrl";
  if (!isAllowedImageUrl(o.imageUrl, opts.imageHosts)) return "imageUrl";
  return undefined;
}
