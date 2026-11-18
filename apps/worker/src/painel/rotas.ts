import { type Db, tabelas as t } from "@achadinhos/db";
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { SelectedFields } from "drizzle-orm/pg-core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { gastoLlm } from "../ciclo/copy.js";
import { diaBrt, horarioBrt } from "../ciclo/disparo.js";
import { lerRegrasEnvio } from "../ciclo/regras.js";
import { historicoPrecos } from "../coleta/servico.js";
import { ErroNegocio } from "../servicos.js";

/** Leitura agregada para o painel (Prompt 6). Tudo em horário de Brasília. */

const inicioDoDia = (offsetDias = 0) =>
  horarioBrt(diaBrt(new Date(Date.now() + offsetDias * 86_400_000)), "00:00");
const n = (v: unknown) => (v == null ? 0 : Number(v));

export async function resumoDoDia(db: Db) {
  const hoje = inicioDoDia();
  const ontem = inicioDoDia(-1);
  const contar = async (
    tabela: "envios" | "cliques" | "checagens",
    de: Date,
    ate: Date,
    extra?: ReturnType<typeof eq>,
  ) => {
    const tb = t[tabela];
    const [r] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(tb)
      .where(and(gte(tb.criadoEm, de), lt(tb.criadoEm, ate), extra));
    return r?.n ?? 0;
  };
  const amanha = inicioDoDia(1);
  const [env] = await db
    .select({
      enviadas: sql<number>`count(*) filter (where ${t.envios.status} = 'enviado')::int`,
      agendadas: sql<number>`count(*) filter (where ${t.envios.status} = 'agendado')::int`,
      falhas: sql<number>`count(*) filter (where ${t.envios.status} = 'falhou')::int`,
    })
    .from(t.envios)
    .where(and(gte(t.envios.agendadoPara, hoje), lt(t.envios.agendadoPara, amanha)));
  const [chk] = await db
    .select({
      avaliadas: sql<number>`count(*)::int`,
      reprovadas: sql<number>`count(*) filter (where not ${t.checagens.aprovada})::int`,
    })
    .from(t.checagens)
    .where(gte(t.checagens.criadoEm, hoje));
  const conv = async (de: Date, ate: Date) => {
    const [r] = await db
      .select({
        n: sql<number>`count(*)::int`,
        comissao: sql<string>`coalesce(sum(${t.conversoes.comissao}), 0)`,
      })
      .from(t.conversoes)
      .where(and(gte(t.conversoes.dia, diaBrt(de)), lt(t.conversoes.dia, diaBrt(ate))));
    return { n: r?.n ?? 0, comissao: n(r?.comissao) };
  };
  const [proxima] = await db
    .select({ em: t.envios.agendadoPara, grupo: t.grupos.nome, produto: t.produtos.nome })
    .from(t.envios)
    .innerJoin(t.grupos, eq(t.grupos.id, t.envios.grupoId))
    .innerJoin(t.ofertas, eq(t.ofertas.id, t.envios.ofertaId))
    .innerJoin(t.produtos, eq(t.produtos.id, t.ofertas.produtoId))
    .where(and(eq(t.envios.status, "agendado"), gte(t.envios.agendadoPara, new Date())))
    .orderBy(t.envios.agendadoPara)
    .limit(1);
  const alertas = await db
    .select({ id: t.eventos.id, tipo: t.eventos.tipo, dados: t.eventos.dados, criadoEm: t.eventos.criadoEm })
    .from(t.eventos)
    .where(
      and(
        inArray(t.eventos.tipo, [
          "alerta",
          "sistema.pausado",
          "numero_banido",
          "numero.failover",
          "disparo.cancelado",
          "marketplace.erro",
        ]),
        gte(t.eventos.criadoEm, ontem),
      ),
    )
    .orderBy(desc(t.eventos.id))
    .limit(6);
  const regras = await lerRegrasEnvio(db);
  const [hojeConv, ontemConv] = [await conv(hoje, amanha), await conv(ontem, hoje)];
  return {
    ofertas: {
      enviadas: env?.enviadas ?? 0,
      agendadas: env?.agendadas ?? 0,
      falhas: env?.falhas ?? 0,
      avaliadas: chk?.avaliadas ?? 0,
      reprovadas: chk?.reprovadas ?? 0,
    },
    cliques: { hoje: await contar("cliques", hoje, amanha), ontem: await contar("cliques", ontem, hoje) },
    conversoes: { hoje: hojeConv.n, ontem: ontemConv.n },
    comissao: { hoje: hojeConv.comissao, ontem: ontemConv.comissao },
    llm: { ...(await gastoLlm(db)), tetoDiario: regras.tetoDiarioUsd, tetoMensal: regras.tetoMensalUsd },
    proxima: proxima
      ? { em: proxima.em?.toISOString() ?? null, grupo: proxima.grupo, produto: proxima.produto }
      : null,
    alertas: alertas.map((a) => ({ ...a, criadoEm: a.criadoEm.toISOString() })),
  };
}

export type Recorte = "nicho" | "grupo" | "horario" | "oferta";

/** Enviadas, cliques, conversões, comissão e custo de LLM por recorte (cliques e conversões pelo envio de origem). */
export async function metricas(db: Db, recorte: Recorte, dias: number) {
  const desde = new Date(Date.now() - dias * 86_400_000);
  const chave = {
    nicho: sql<string>`coalesce(${t.nichos.nome}, 'sem nicho')`,
    grupo: sql<string>`${t.grupos.nome}`,
    horario: sql<string>`to_char(${t.envios.agendadoPara} at time zone 'America/Sao_Paulo', 'HH24":00"')`,
    oferta: sql<string>`'#' || ${t.ofertas.id} || ' ' || left(${t.produtos.nome}, 60)`,
  }[recorte];
  const base = <T extends SelectedFields>(campos: T) =>
    db
      .select({ chave, ...campos })
      .from(t.envios)
      .innerJoin(t.grupos, eq(t.grupos.id, t.envios.grupoId))
      .innerJoin(t.ofertas, eq(t.ofertas.id, t.envios.ofertaId))
      .innerJoin(t.produtos, eq(t.produtos.id, t.ofertas.produtoId))
      .leftJoin(t.nichos, eq(t.nichos.id, sql`coalesce(${t.ofertas.nichoId}, ${t.produtos.nichoId})`))
      .leftJoin(t.links, and(eq(t.links.ofertaId, t.envios.ofertaId), eq(t.links.grupoId, t.envios.grupoId)));
  const filtro = and(eq(t.envios.status, "enviado"), gte(t.envios.agendadoPara, desde));
  const envs = await base({
    enviadas: sql<number>`count(distinct ${t.envios.id})::int`,
    ofertaIds: sql<number[]>`array_agg(distinct ${t.envios.ofertaId})`,
  })
    .where(filtro)
    .groupBy(chave);
  const clq = await base({ cliques: sql<number>`count(${t.cliques.id})::int` })
    .innerJoin(t.cliques, eq(t.cliques.linkId, t.links.id))
    .where(filtro)
    .groupBy(chave);
  const cnv = await base({
    conversoes: sql<number>`count(${t.conversoes.id})::int`,
    comissao: sql<string>`coalesce(sum(${t.conversoes.comissao}), 0)`,
  })
    .innerJoin(t.conversoes, eq(t.conversoes.linkId, t.links.id))
    .where(filtro)
    .groupBy(chave);
  const resultado = [];
  for (const e of envs) {
    const ids = (e.ofertaIds ?? []).map(Number);
    const [custo] =
      ids.length && (recorte === "oferta" || recorte === "nicho")
        ? await db
            .select({ v: sql<string>`coalesce(sum(${t.chamadasPagas.custoUsd}), 0)` })
            .from(t.chamadasPagas)
            .where(inArray(t.chamadasPagas.ofertaId, ids))
        : [];
    const c = cnv.find((x) => x.chave === e.chave);
    resultado.push({
      chave: e.chave,
      enviadas: e.enviadas,
      cliques: clq.find((x) => x.chave === e.chave)?.cliques ?? 0,
      conversoes: c?.conversoes ?? 0,
      comissao: n(c?.comissao),
      custoLlmUsd: custo ? n(custo.v) : null,
    });
  }
  return resultado.sort((a, b) => b.comissao - a.comissao || b.cliques - a.cliques);
}

export function rotasPainel(app: FastifyInstance, db: Db) {
  app.get("/painel/resumo", async () => resumoDoDia(db));

  app.get("/metricas", async (req) => {
    const q = z
      .object({
        recorte: z.enum(["nicho", "grupo", "horario", "oferta"]).default("nicho"),
        dias: z.coerce.number().int().min(1).max(90).default(7),
      })
      .parse(req.query);
    return { recorte: q.recorte, dias: q.dias, linhas: await metricas(db, q.recorte, q.dias) };
  });

  app.get("/links", async (req) => {
    const q = z.object({ dias: z.coerce.number().int().min(1).max(90).default(7) }).parse(req.query);
    const desde = new Date(Date.now() - q.dias * 86_400_000);
    const linhas = await db
      .select({
        id: t.links.id,
        codigo: t.links.codigoCurto,
        ofertaId: t.links.ofertaId,
        produto: t.produtos.nome,
        grupo: t.grupos.nome,
        subIds: t.links.subIds,
        criadoEm: t.links.criadoEm,
        cliques: sql<number>`(select count(*) from ${t.cliques} c where c.link_id = ${t.links.id})::int`,
        unicos: sql<number>`(select count(distinct c.ip_hash) from ${t.cliques} c where c.link_id = ${t.links.id})::int`,
      })
      .from(t.links)
      .innerJoin(t.ofertas, eq(t.ofertas.id, t.links.ofertaId))
      .innerJoin(t.produtos, eq(t.produtos.id, t.ofertas.produtoId))
      .leftJoin(t.grupos, eq(t.grupos.id, t.links.grupoId))
      .where(gte(t.links.criadoEm, desde))
      .orderBy(desc(t.links.id))
      .limit(200);
    const porHora = await db
      .select({
        hora: sql<string>`to_char(${t.cliques.criadoEm} at time zone 'America/Sao_Paulo', 'HH24')`,
        n: sql<number>`count(*)::int`,
      })
      .from(t.cliques)
      .where(gte(t.cliques.criadoEm, desde))
      .groupBy(sql`1`)
      .orderBy(sql`1`);
    return { links: linhas, cliquesPorHora: porHora };
  });

  app.get("/conversoes", async (req) => {
    const q = z.object({ dias: z.coerce.number().int().min(1).max(90).default(30) }).parse(req.query);
    const linhas = await db
      .select({
        id: t.conversoes.id,
        pedido: t.conversoes.pedidoExterno,
        valor: t.conversoes.valor,
        comissao: t.conversoes.comissao,
        status: t.conversoes.status,
        dia: t.conversoes.dia,
        subIds: t.conversoes.subIds,
        ofertaId: t.links.ofertaId,
        grupo: t.grupos.nome,
        produto: t.produtos.nome,
      })
      .from(t.conversoes)
      .leftJoin(t.links, eq(t.links.id, t.conversoes.linkId))
      .leftJoin(t.grupos, eq(t.grupos.id, t.links.grupoId))
      .leftJoin(t.ofertas, eq(t.ofertas.id, t.links.ofertaId))
      .leftJoin(t.produtos, eq(t.produtos.id, t.ofertas.produtoId))
      .where(gte(t.conversoes.dia, diaBrt(new Date(Date.now() - q.dias * 86_400_000))))
      .orderBy(desc(t.conversoes.dia), desc(t.conversoes.id))
      .limit(500);
    return { conversoes: linhas };
  });

  /** Detalhe da oferta: produto, curva de preço, peças, copies, checagens e envios. */
  app.get("/ofertas/:id", async (req) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
    const [l] = await db
      .select({ oferta: t.ofertas, produto: t.produtos, nicho: t.nichos.nome })
      .from(t.ofertas)
      .innerJoin(t.produtos, eq(t.produtos.id, t.ofertas.produtoId))
      .leftJoin(t.nichos, eq(t.nichos.id, sql`coalesce(${t.ofertas.nichoId}, ${t.produtos.nichoId})`))
      .where(eq(t.ofertas.id, id));
    if (!l) throw new ErroNegocio(404, "nao_encontrado", `oferta ${id} não existe`);
    const [historico, imagens, copies, checagens, envios] = await Promise.all([
      historicoPrecos(db, l.produto.id, 30),
      db.select().from(t.imagens).where(eq(t.imagens.ofertaId, id)).orderBy(desc(t.imagens.id)).limit(6),
      db.select().from(t.copies).where(eq(t.copies.ofertaId, id)).orderBy(desc(t.copies.id)).limit(6),
      db
        .select()
        .from(t.checagens)
        .where(eq(t.checagens.ofertaId, id))
        .orderBy(desc(t.checagens.id))
        .limit(10),
      db
        .select({ envio: t.envios, grupo: t.grupos.nome })
        .from(t.envios)
        .innerJoin(t.grupos, eq(t.grupos.id, t.envios.grupoId))
        .where(eq(t.envios.ofertaId, id))
        .orderBy(desc(t.envios.id)),
    ]);
    return { ...l, historico, imagens, copies, checagens, envios };
  });

  // ---------- auditoria (T6.9) ----------
  app.get("/auditoria", async (req) => {
    const q = z.object({ limite: z.coerce.number().int().min(1).max(500).default(100) }).parse(req.query);
    return { registros: await db.select().from(t.auditoria).orderBy(desc(t.auditoria.id)).limit(q.limite) };
  });
  app.post("/auditoria", async (req, reply) => {
    const b = z
      .object({
        ator: z.string().trim().min(1).max(120),
        acao: z.string().trim().min(1).max(80),
        alvo: z.string().max(200).nullable().optional(),
        detalhes: z.record(z.string(), z.unknown()).default({}),
      })
      .parse(req.body);
    const [r] = await db
      .insert(t.auditoria)
      .values({ ator: b.ator, acao: b.acao, alvo: b.alvo ?? null, detalhes: b.detalhes })
      .returning();
    return reply.code(201).send(r);
  });
}
