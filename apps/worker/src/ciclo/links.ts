import { createHash, randomBytes } from "node:crypto";
import { type Db, tabelas as t } from "@achadinhos/db";
import type { MarketplaceAdapter } from "@achadinhos/marketplace";
import { and, eq } from "drizzle-orm";
import { ErroNegocio } from "../servicos.js";

const ALFABETO = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function novoCodigo(n = 7): string {
  const b = randomBytes(n);
  return [...b].map((x) => ALFABETO[x % ALFABETO.length]).join("");
}

/**
 * T5.2: um código por oferta e grupo. Na Shopee, o link de afiliado sai do generateShortLink com os subIds
 * (grupo, nicho, oferta, horário e o próprio código), que voltam no relatório de conversões.
 */
export async function obterLink(
  db: Db,
  mk: MarketplaceAdapter | null,
  ofertaId: number,
  grupoId: number,
  horario: Date,
): Promise<{ id: number; codigo: string }> {
  const [existente] = await db
    .select({ id: t.links.id, codigo: t.links.codigoCurto })
    .from(t.links)
    .where(and(eq(t.links.ofertaId, ofertaId), eq(t.links.grupoId, grupoId)));
  if (existente) return existente;
  const [l] = await db
    .select({ oferta: t.ofertas, produto: t.produtos })
    .from(t.ofertas)
    .innerJoin(t.produtos, eq(t.produtos.id, t.ofertas.produtoId))
    .where(eq(t.ofertas.id, ofertaId));
  if (!l) throw new ErroNegocio(404, "nao_encontrado", `oferta ${ofertaId} não existe`);
  const codigo = novoCodigo();
  const hhmm = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(horario)
    .replace(":", "");
  const subIds = {
    grupo: `g${grupoId}`,
    nicho: `n${l.oferta.nichoId ?? l.produto.nichoId ?? 0}`,
    oferta: `o${ofertaId}`,
    horario: `h${hhmm}`,
    codigo,
  };
  let url = l.produto.linkAfiliado ?? l.produto.url;
  if (mk && !l.oferta.ensaio && l.produto.marketplace === mk.nome) {
    try {
      url = await mk.gerarLinkAfiliado(l.produto.url, Object.values(subIds));
    } catch {
      // sem o link curto, o offerLink da busca ainda é de afiliado (só perde os subIds)
    }
  }
  const [novo] = await db
    .insert(t.links)
    .values({ ofertaId, grupoId, urlAfiliado: url, codigoCurto: codigo, subIds })
    .onConflictDoNothing()
    .returning({ id: t.links.id, codigo: t.links.codigoCurto });
  if (novo) return novo;
  const [corrida] = await db
    .select({ id: t.links.id, codigo: t.links.codigoCurto })
    .from(t.links)
    .where(and(eq(t.links.ofertaId, ofertaId), eq(t.links.grupoId, grupoId)));
  if (!corrida) throw new Error("falha ao gravar o link");
  return corrida;
}

/** Hash do IP com sal: dá para contar cliques únicos sem guardar o IP. */
export function hashIp(ip: string, sal: string): string {
  return createHash("sha256").update(`${sal}:${ip}`).digest("hex").slice(0, 32);
}

/** Registra o clique e devolve o destino (o painel responde 302). */
export async function registrarClique(
  db: Db,
  codigo: string,
  ipHash: string | null,
  userAgent: string | null,
) {
  const [l] = await db
    .select({
      id: t.links.id,
      url: t.links.urlAfiliado,
      ofertaId: t.links.ofertaId,
      grupoId: t.links.grupoId,
    })
    .from(t.links)
    .where(eq(t.links.codigoCurto, codigo));
  if (!l) return null;
  await db.insert(t.cliques).values({ linkId: l.id, ipHash, userAgent: userAgent?.slice(0, 300) ?? null });
  return { destino: l.url, ofertaId: l.ofertaId, grupoId: l.grupoId };
}
