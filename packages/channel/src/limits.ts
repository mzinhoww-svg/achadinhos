/**
 * Constantes compartilhadas (B3). `AFFILIATE_LINK_HOSTS` e `MAX_LINK_LENGTH` são cópia de
 * `apps/worker/src/links.ts` (ativo); a paridade é garantida por `apps/worker/tests/paridade.test.ts`
 * (T7-B), que importa os dois lados e compara hosts, `MAX_LINK_LENGTH` e o resultado de `isAllowedLink`.
 * `MAX_CREATIVE_PNG_BYTES = 5_000_000` é o valor de `MAX_IMAGE_BYTES` em `apps/worker/src/sql/build-deps.ts`,
 * que é dormente e não exportado — **não há paridade para ele**: o `channel` passa a ser a fonte.
 * O `channel` NÃO importa de `apps/worker`.
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
