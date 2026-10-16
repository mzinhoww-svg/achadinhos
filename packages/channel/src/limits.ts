/**
 * Constantes compartilhadas (B3). Os valores são cópia de `apps/worker/src/links.ts`
 * (`DEFAULT_SHOPEE_LINK_HOSTS`, `MAX_LINK_LENGTH`) e de `apps/worker/src/sql/build-deps.ts`
 * (`MAX_IMAGE_BYTES`). O `channel` NÃO importa de `apps/worker`; a paridade é garantida por um
 * teste em `apps/worker/tests/` (T7-B) que importa os dois lados.
 */

/** Hosts de afiliado/produto da Shopee (decisão 004). */
export const AFFILIATE_LINK_HOSTS = ["shopee.com.br", "shp.ee", "shope.ee", "s.shopee.com.br"];

export const MAX_LINK_LENGTH = 300;

/** Teto do criativo PNG em bytes. */
export const MAX_CREATIVE_PNG_BYTES = 5_000_000;

/** https, sem credenciais embutidas, host exato ou subdomínio de um host permitido, tamanho limitado. */
export function isAllowedLink(raw: unknown, hosts: string[], maxLength = MAX_LINK_LENGTH): boolean {
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
