import { type Db, tabelas as t } from "@achadinhos/db";
import type { MarketplaceAdapter } from "@achadinhos/marketplace";
import { and, eq, gte, sql } from "drizzle-orm";
import { registrarEvento } from "../servicos.js";
import { diaBrt } from "./disparo.js";

/**
 * T8.1: importa o relatório de conversões da Shopee e liga cada pedido ao link (oferta + grupo) pelos subIds
 * (grupo gN, nicho nN, oferta oN, horário hHHMM e o código do link). Reimportar atualiza o status e a comissão.
 */
export async function importarConversoes(
  db: Db,
  mk: MarketplaceAdapter | null,
  dias = 7,
  agora = new Date(),
) {
  if (!mk?.conversoes)
    return { importadas: 0, ligadas: 0, motivo: "marketplace sem relatório de conversões" };
  const desde = new Date(agora.getTime() - dias * 86_400_000);
  const lista = await mk.conversoes(desde, agora);
  let ligadas = 0;
  for (const c of lista) {
    const sub: Record<string, string> = {};
    for (const s of c.subIds) {
      const m = /^([gnoh])(\d+)$/.exec(s);
      if (m?.[1] === "g") sub.grupo = s;
      else if (m?.[1] === "n") sub.nicho = s;
      else if (m?.[1] === "o") sub.oferta = s;
      else if (m?.[1] === "h") sub.horario = s;
      else if (/^[A-Za-z0-9]{6,16}$/.test(s)) sub.codigo = s;
    }
    let linkId: number | null = null;
    if (sub.codigo) {
      const [l] = await db
        .select({ id: t.links.id })
        .from(t.links)
        .where(eq(t.links.codigoCurto, sub.codigo));
      linkId = l?.id ?? null;
    }
    if (!linkId && sub.oferta && sub.grupo) {
      const [l] = await db
        .select({ id: t.links.id })
        .from(t.links)
        .where(
          and(
            eq(t.links.ofertaId, Number(sub.oferta.slice(1))),
            eq(t.links.grupoId, Number(sub.grupo.slice(1))),
          ),
        );
      linkId = l?.id ?? null;
    }
    if (linkId) ligadas++;
    const valores = {
      linkId,
      subIds: sub,
      valor: c.valor.toFixed(2),
      comissao: c.comissao.toFixed(2),
      status: c.status || null,
      dia: diaBrt(c.compradoEm),
    };
    await db
      .insert(t.conversoes)
      .values({ marketplace: mk.nome, pedidoExterno: c.pedido, ...valores })
      .onConflictDoUpdate({ target: [t.conversoes.marketplace, t.conversoes.pedidoExterno], set: valores });
  }
  await registrarEvento(db, {
    tipo: "conversoes.importadas",
    agente: "worker",
    dados: { dias, importadas: lista.length, ligadas },
  });
  return { importadas: lista.length, ligadas, motivo: null };
}

/** Custo de LLM por agente (worker e OpenBot) no período. */
export async function custosPorAgente(db: Db, dias: number) {
  const desde = new Date(Date.now() - dias * 86_400_000);
  const linhas = await db
    .select({
      agente: sql<string>`coalesce(${t.chamadasPagas.agente}, 'worker')`,
      chamadas: sql<number>`count(*)::int`,
      custoUsd: sql<string>`coalesce(sum(${t.chamadasPagas.custoUsd}), 0)`,
      falhas: sql<number>`count(*) filter (where not ${t.chamadasPagas.sucesso})::int`,
    })
    .from(t.chamadasPagas)
    .where(and(eq(t.chamadasPagas.servico, "llm"), gte(t.chamadasPagas.criadoEm, desde)))
    .groupBy(sql`1`)
    .orderBy(sql`3 desc`);
  const [env] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(t.envios)
    .where(and(eq(t.envios.status, "enviado"), gte(t.envios.enviadoEm, desde)));
  const total = linhas.reduce((a, l) => a + Number(l.custoUsd), 0);
  return {
    dias,
    agentes: linhas.map((l) => ({ ...l, custoUsd: Number(l.custoUsd) })),
    totalUsd: total,
    enviadas: env?.n ?? 0,
    custoPorOfertaEnviadaUsd: env?.n ? total / env.n : null,
  };
}
