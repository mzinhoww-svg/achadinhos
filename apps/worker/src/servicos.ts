import { type Db, tabelas as t } from "@achadinhos/db";
import type {
  CriarProposta,
  DecidirProposta,
  DocBiblia,
  Evento,
  GravarDocBiblia,
  Proposta,
  RegistrarEvento,
  ResumoDocBiblia,
} from "@achadinhos/shared";
import { and, desc, eq, gt, sql } from "drizzle-orm";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Executor = Db | Tx;

export class ErroNegocio extends Error {
  constructor(
    readonly status: number,
    readonly codigo: string,
    message: string,
  ) {
    super(message);
  }
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

// ---------- eventos ----------

export async function registrarEvento(db: Executor, e: RegistrarEvento): Promise<Evento> {
  const [linha] = await db
    .insert(t.eventos)
    .values({ tipo: e.tipo, agente: e.agente, dados: e.dados ?? {}, ofertaId: e.ofertaId ?? null })
    .returning();
  if (!linha) throw new Error("falha ao gravar evento");
  return eventoParaApi(linha);
}

export function eventoParaApi(l: typeof t.eventos.$inferSelect): Evento {
  return {
    id: l.id,
    tipo: l.tipo,
    agente: l.agente,
    dados: l.dados,
    ofertaId: l.ofertaId,
    criadoEm: l.criadoEm.toISOString(),
  };
}

export async function listarEventos(
  db: Db,
  f: { desde?: number; tipo?: string; agente?: string; limite: number },
): Promise<Evento[]> {
  const conds = [];
  if (f.desde !== undefined) conds.push(gt(t.eventos.id, f.desde));
  if (f.tipo) conds.push(eq(t.eventos.tipo, f.tipo));
  if (f.agente) conds.push(eq(t.eventos.agente, f.agente));
  const linhas = await db
    .select()
    .from(t.eventos)
    .where(conds.length ? and(...conds) : undefined)
    // Com "desde", em ordem crescente (para seguir o fluxo); sem, os mais recentes primeiro.
    .orderBy(f.desde !== undefined ? t.eventos.id : desc(t.eventos.id))
    .limit(f.limite);
  return linhas.map(eventoParaApi);
}

export async function buscarEvento(db: Db, id: number): Promise<Evento | null> {
  const [l] = await db.select().from(t.eventos).where(eq(t.eventos.id, id));
  return l ? eventoParaApi(l) : null;
}

// ---------- bíblia ----------

function docParaApi(l: typeof t.bibliaDocs.$inferSelect): DocBiblia {
  return {
    slug: l.slug,
    versao: l.versao,
    titulo: l.titulo,
    conteudo: l.conteudo,
    autor: l.autor,
    motivo: l.motivo,
    criadoEm: l.criadoEm.toISOString(),
  };
}

/** Cria uma nova versão do documento (a primeira é 1). Versões antigas nunca são alteradas. */
export async function gravarDoc(
  db: Db,
  d: GravarDocBiblia,
  propostaId?: number,
  tx?: Tx,
): Promise<DocBiblia> {
  const executar = async (x: Tx) => {
    // Serializa as gravações do mesmo slug, para duas versões não disputarem o mesmo número.
    await x.execute(sql`select pg_advisory_xact_lock(hashtext(${`biblia:${d.slug}`}))`);
    const [atual] = await x
      .select({ versao: t.bibliaDocs.versao, titulo: t.bibliaDocs.titulo })
      .from(t.bibliaDocs)
      .where(eq(t.bibliaDocs.slug, d.slug))
      .orderBy(desc(t.bibliaDocs.versao))
      .limit(1);
    const versao = (atual?.versao ?? 0) + 1;
    const [linha] = await x
      .insert(t.bibliaDocs)
      .values({
        slug: d.slug,
        versao,
        titulo: d.titulo ?? atual?.titulo ?? d.slug,
        conteudo: d.conteudo,
        autor: d.autor,
        motivo: d.motivo ?? null,
        propostaId: propostaId ?? null,
      })
      .returning();
    if (!linha) throw new Error("falha ao gravar documento");
    await registrarEvento(x, { tipo: "biblia.atualizada", agente: d.autor, dados: { slug: d.slug, versao } });
    await x.insert(t.auditoria).values({
      ator: d.autor,
      acao: "biblia.gravar",
      alvo: `${d.slug}@${versao}`,
      detalhes: { motivo: d.motivo ?? null },
    });
    return docParaApi(linha);
  };
  return tx ? executar(tx) : db.transaction(executar);
}

export async function listarDocs(db: Db): Promise<ResumoDocBiblia[]> {
  const linhas = await db.execute<{
    slug: string;
    versao: number;
    titulo: string;
    autor: string;
    motivo: string | null;
    criado_em: Date | string;
    tamanho: number;
  }>(sql`
    select distinct on (slug) slug, versao, titulo, autor, motivo, criado_em, length(conteudo)::int as tamanho
    from achadinhos.biblia_docs
    order by slug, versao desc`);
  return linhas.rows.map((l) => ({
    slug: l.slug,
    versao: Number(l.versao),
    titulo: l.titulo,
    autor: l.autor,
    motivo: l.motivo,
    criadoEm: new Date(l.criado_em).toISOString(),
    tamanho: Number(l.tamanho),
  }));
}

export async function lerDoc(db: Db, slug: string, versao?: number): Promise<DocBiblia | null> {
  const [l] = await db
    .select()
    .from(t.bibliaDocs)
    .where(
      versao
        ? and(eq(t.bibliaDocs.slug, slug), eq(t.bibliaDocs.versao, versao))
        : eq(t.bibliaDocs.slug, slug),
    )
    .orderBy(desc(t.bibliaDocs.versao))
    .limit(1);
  return l ? docParaApi(l) : null;
}

export async function versoesDoc(db: Db, slug: string): Promise<Omit<DocBiblia, "conteudo">[]> {
  const linhas = await db
    .select({
      slug: t.bibliaDocs.slug,
      versao: t.bibliaDocs.versao,
      titulo: t.bibliaDocs.titulo,
      autor: t.bibliaDocs.autor,
      motivo: t.bibliaDocs.motivo,
      criadoEm: t.bibliaDocs.criadoEm,
    })
    .from(t.bibliaDocs)
    .where(eq(t.bibliaDocs.slug, slug))
    .orderBy(desc(t.bibliaDocs.versao));
  return linhas.map((l) => ({ ...l, criadoEm: l.criadoEm.toISOString() }));
}

// ---------- propostas ----------

function propostaParaApi(l: typeof t.propostas.$inferSelect): Proposta {
  return {
    id: l.id,
    titulo: l.titulo,
    descricao: l.descricao,
    autor: l.autor,
    docSlug: l.docSlug,
    conteudoProposto: l.conteudoProposto,
    status: l.status,
    decididoPor: l.decididoPor,
    comentario: l.comentario,
    criadoEm: l.criadoEm.toISOString(),
    decididoEm: iso(l.decididoEm),
  };
}

export async function criarProposta(db: Db, p: CriarProposta): Promise<Proposta> {
  if ((p.docSlug === undefined) !== (p.conteudoProposto === undefined)) {
    throw new ErroNegocio(400, "entrada_invalida", "docSlug e conteudoProposto vão juntos");
  }
  return db.transaction(async (x) => {
    const [l] = await x
      .insert(t.propostas)
      .values({
        titulo: p.titulo,
        descricao: p.descricao,
        autor: p.autor,
        docSlug: p.docSlug ?? null,
        conteudoProposto: p.conteudoProposto ?? null,
      })
      .returning();
    if (!l) throw new Error("falha ao gravar proposta");
    await registrarEvento(x, {
      tipo: "proposta.criada",
      agente: p.autor,
      dados: { propostaId: l.id, docSlug: l.docSlug },
    });
    return propostaParaApi(l);
  });
}

export async function listarPropostas(db: Db, status?: Proposta["status"]): Promise<Proposta[]> {
  const linhas = await db
    .select()
    .from(t.propostas)
    .where(status ? eq(t.propostas.status, status) : undefined)
    .orderBy(desc(t.propostas.id))
    .limit(200);
  return linhas.map(propostaParaApi);
}

/** Aprovar uma proposta com documento grava a nova versão da bíblia na mesma transação. */
export async function decidirProposta(
  db: Db,
  id: number,
  d: DecidirProposta,
): Promise<{ proposta: Proposta; doc: DocBiblia | null }> {
  return db.transaction(async (x) => {
    const [atual] = await x.select().from(t.propostas).where(eq(t.propostas.id, id)).for("update");
    if (!atual) throw new ErroNegocio(404, "nao_encontrada", "proposta não encontrada");
    if (atual.status !== "aberta")
      throw new ErroNegocio(409, "ja_decidida", `proposta já está ${atual.status}`);
    const [l] = await x
      .update(t.propostas)
      .set({
        status: d.decisao,
        decididoPor: d.decididoPor,
        comentario: d.comentario ?? null,
        decididoEm: new Date(),
      })
      .where(eq(t.propostas.id, id))
      .returning();
    if (!l) throw new Error("falha ao decidir proposta");
    let doc: DocBiblia | null = null;
    if (d.decisao === "aprovada" && l.docSlug && l.conteudoProposto) {
      doc = await gravarDoc(
        db,
        {
          slug: l.docSlug,
          conteudo: l.conteudoProposto,
          autor: d.decididoPor,
          motivo: `Proposta #${l.id}: ${l.titulo}`,
        },
        l.id,
        x,
      );
    }
    await registrarEvento(x, {
      tipo: `proposta.${d.decisao}`,
      agente: d.decididoPor,
      dados: { propostaId: l.id },
    });
    return { proposta: propostaParaApi(l), doc };
  });
}
