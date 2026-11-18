import { type Db, tabelas as t } from "@achadinhos/db";
import type { MarketplaceAdapter, ProdutoMarketplace } from "@achadinhos/marketplace";
import { and, asc, desc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { ErroNegocio, registrarEvento } from "../servicos.js";
import { type Avaliacao, avaliarOferta, REGRAS_PADRAO, type RegrasOferta } from "./regras.js";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Executor = Db | Tx;

const n = (v: string | null | undefined): number | null => (v == null ? null : Number(v));
const s = (v: number | null | undefined): string | null => (v == null ? null : String(v));

// ---------- nichos ----------

export interface EntradaNicho {
  nome: string;
  palavras: string[];
  precoMin?: number | null;
  precoMax?: number | null;
  descontoMinPct?: number;
  avaliacaoMin?: number;
  vendasMin?: number;
  ativo?: boolean;
  marketplace?: "shopee" | "mercadolivre" | "fake";
  template?: string | null;
  modeloLlm?: string | null;
}

/** Cria ou atualiza o nicho pelo nome; as palavras-chave passam a ser exatamente as enviadas. */
export async function salvarNicho(db: Db, e: EntradaNicho, autor: string) {
  return db.transaction(async (x) => {
    const valores = {
      nome: e.nome,
      ativo: e.ativo ?? true,
      precoMin: s(e.precoMin),
      precoMax: s(e.precoMax),
      marketplace: e.marketplace ?? "shopee",
      descontoMinPct: String(e.descontoMinPct ?? REGRAS_PADRAO.descontoMinPct),
      avaliacaoMin: String(e.avaliacaoMin ?? REGRAS_PADRAO.avaliacaoMin),
      vendasMin: e.vendasMin ?? REGRAS_PADRAO.vendasMin,
      template: e.template ?? null,
      modeloLlm: e.modeloLlm ?? null,
    };
    const [nicho] = await x
      .insert(t.nichos)
      .values(valores)
      .onConflictDoUpdate({ target: t.nichos.nome, set: valores })
      .returning();
    if (!nicho) throw new Error("falha ao gravar nicho");
    const termos = [...new Set(e.palavras.map((p) => p.trim().toLowerCase()).filter(Boolean))];
    await x.delete(t.palavrasChave).where(eq(t.palavrasChave.nichoId, nicho.id));
    if (termos.length)
      await x.insert(t.palavrasChave).values(termos.map((termo) => ({ nichoId: nicho.id, termo })));
    await registrarEvento(x, {
      tipo: "nicho.salvo",
      agente: autor,
      dados: { nichoId: nicho.id, nome: nicho.nome, palavras: termos.length },
    });
    return { ...nicho, palavras: termos };
  });
}

export async function listarNichos(db: Db) {
  const nichos = await db.select().from(t.nichos).orderBy(asc(t.nichos.nome));
  const palavras = await db.select().from(t.palavrasChave).where(eq(t.palavrasChave.ativo, true));
  return nichos.map((ni) => ({
    ...ni,
    palavras: palavras.filter((p) => p.nichoId === ni.id).map((p) => p.termo),
  }));
}

async function carregarNicho(db: Db, ref: { nichoId?: number; nome?: string }) {
  const [nicho] = await db
    .select()
    .from(t.nichos)
    .where(ref.nichoId ? eq(t.nichos.id, ref.nichoId) : eq(t.nichos.nome, ref.nome ?? ""));
  if (!nicho)
    throw new ErroNegocio(404, "nicho_nao_encontrado", "nicho não encontrado; cadastre em POST /nichos");
  const palavras = await db
    .select({ termo: t.palavrasChave.termo })
    .from(t.palavrasChave)
    .where(and(eq(t.palavrasChave.nichoId, nicho.id), eq(t.palavrasChave.ativo, true)));
  return { ...nicho, palavras: palavras.map((p) => p.termo) };
}

function regrasDoNicho(
  nicho: { descontoMinPct: string; avaliacaoMin: string; vendasMin: number } | null,
  base: RegrasOferta,
): RegrasOferta {
  if (!nicho) return base;
  return {
    ...base,
    descontoMinPct: Number(nicho.descontoMinPct),
    avaliacaoMin: Number(nicho.avaliacaoMin),
    vendasMin: nicho.vendasMin,
  };
}

// ---------- produtos e histórico ----------

/** Grava (ou atualiza) o produto. Dedupe por marketplace + id externo. */
async function gravarProduto(x: Executor, p: ProdutoMarketplace, nichoId: number | null) {
  const agora = new Date();
  const valores = {
    marketplace: p.marketplace,
    idExterno: p.idExterno,
    lojaId: p.lojaId,
    lojaNome: p.lojaNome,
    nome: p.nome,
    url: p.url,
    linkAfiliado: p.linkAfiliado,
    fotoUrl: p.fotoUrl,
    precoAtual: String(p.preco),
    precoMax: s(p.precoMax),
    descontoAnunciado: s(p.descontoAnunciado),
    avaliacao: s(p.avaliacao),
    vendas: p.vendas == null ? null : Math.round(p.vendas),
    comissaoTaxa: s(p.comissaoTaxa),
    comissaoValor: s(p.comissaoValor),
    emEstoque: p.emEstoque,
    ultimaColetaEm: agora,
    atualizadoEm: agora,
  };
  const { marketplace: _m, idExterno: _i, ...atualizar } = valores;
  const [linha] = await x
    .insert(t.produtos)
    .values({ ...valores, nichoId, acompanhado: true })
    .onConflictDoUpdate({
      target: [t.produtos.marketplace, t.produtos.idExterno],
      // O nicho de quem achou primeiro fica; os dados de preço e loja são sempre os mais novos.
      set: { ...atualizar, nichoId: sql`coalesce(${t.produtos.nichoId}, excluded.nicho_id)` },
    })
    .returning({ id: t.produtos.id, novo: sql<boolean>`(xmax = 0)` });
  if (!linha) throw new Error("falha ao gravar produto");
  return linha;
}

/** Registra a observação de preço. Não repete o mesmo preço dentro de 60 minutos (coleta e monitor juntos). */
async function gravarObservacao(
  x: Executor,
  produtoId: number,
  preco: number,
  precoOriginal: number | null,
  emEstoque: boolean | null,
) {
  const [ultima] = await x
    .select()
    .from(t.historicoPrecos)
    .where(eq(t.historicoPrecos.produtoId, produtoId))
    .orderBy(desc(t.historicoPrecos.coletadoEm))
    .limit(1);
  if (ultima && Number(ultima.preco) === preco && Date.now() - ultima.coletadoEm.getTime() < 60 * 60_000)
    return false;
  await x
    .insert(t.historicoPrecos)
    .values({ produtoId, preco: String(preco), precoOriginal: s(precoOriginal), emEstoque });
  return true;
}

// ---------- coleta (T2.2) ----------

export interface ResultadoColeta {
  nicho: { id: number; nome: string };
  palavras: { termo: string; encontrados: number; erro?: string }[];
  produtos: number;
  novos: number;
  atualizados: number;
  observacoes: number;
}

export async function coletarNicho(
  db: Db,
  adapter: MarketplaceAdapter,
  ref: { nichoId?: number; nome?: string },
  opcoes: { paginas?: number; limite?: number; agente?: string } = {},
): Promise<ResultadoColeta> {
  const nicho = await carregarNicho(db, ref);
  if (!nicho.palavras.length)
    throw new ErroNegocio(422, "nicho_sem_palavras", "o nicho não tem palavras-chave ativas");
  const paginas = Math.min(Math.max(opcoes.paginas ?? 1, 1), 5);
  const vistos = new Map<string, ProdutoMarketplace>();
  const porPalavra: ResultadoColeta["palavras"] = [];
  for (const termo of nicho.palavras) {
    let encontrados = 0;
    try {
      for (let pagina = 1; pagina <= paginas; pagina++) {
        const lista = await adapter.buscar(termo, {
          precoMin: n(nicho.precoMin),
          precoMax: n(nicho.precoMax),
          pagina,
          limite: opcoes.limite ?? 50,
        });
        encontrados += lista.length;
        for (const p of lista) vistos.set(`${p.marketplace}:${p.idExterno}`, p);
        if (lista.length === 0) break;
      }
      porPalavra.push({ termo, encontrados });
    } catch (e) {
      // Uma palavra que falha não derruba as outras; o erro já foi para os eventos (comLimite).
      porPalavra.push({ termo, encontrados, erro: e instanceof Error ? e.message : String(e) });
    }
  }
  let novos = 0;
  let observacoes = 0;
  for (const p of vistos.values()) {
    await db.transaction(async (x) => {
      const linha = await gravarProduto(x, p, nicho.id);
      if (linha.novo) novos++;
      if (await gravarObservacao(x, linha.id, p.preco, p.precoMax, p.emEstoque)) observacoes++;
    });
  }
  const r: ResultadoColeta = {
    nicho: { id: nicho.id, nome: nicho.nome },
    palavras: porPalavra,
    produtos: vistos.size,
    novos,
    atualizados: vistos.size - novos,
    observacoes,
  };
  await registrarEvento(db, {
    tipo: "coleta.concluida",
    agente: opcoes.agente ?? "Garimpeiro",
    dados: {
      ...r,
      palavras: porPalavra.map((p) => ({
        termo: p.termo,
        encontrados: p.encontrados,
        falhou: Boolean(p.erro),
      })),
    },
  });
  return r;
}

// ---------- ofertas (T2.4, T2.7) ----------

export type ResultadoDeteccao =
  | { criada: true; ofertaId: number; avaliacao: Avaliacao }
  | { criada: false; motivo: string; avaliacao?: Avaliacao; ofertaId?: number };

/** Avalia o produto pelo histórico e, se for oferta real, cria a oferta candidata (evento oferta_detectada). */
export async function detectarOferta(
  db: Db,
  produtoId: number,
  base: RegrasOferta = REGRAS_PADRAO,
  agente = "Monitor",
): Promise<ResultadoDeteccao> {
  const [produto] = await db.select().from(t.produtos).where(eq(t.produtos.id, produtoId));
  if (!produto) throw new ErroNegocio(404, "produto_nao_encontrado", "produto não encontrado");
  if (produto.precoAtual == null) return { criada: false, motivo: "sem_preco" };
  if (produto.emEstoque === false) return { criada: false, motivo: "sem_estoque" };
  const nicho = produto.nichoId
    ? ((await db.select().from(t.nichos).where(eq(t.nichos.id, produto.nichoId)))[0] ?? null)
    : null;
  const desde = new Date(Date.now() - 30 * 86_400_000);
  const obs = await db
    .select({
      id: t.historicoPrecos.id,
      preco: t.historicoPrecos.preco,
      coletadoEm: t.historicoPrecos.coletadoEm,
    })
    .from(t.historicoPrecos)
    .where(and(eq(t.historicoPrecos.produtoId, produtoId), gte(t.historicoPrecos.coletadoEm, desde)))
    .orderBy(desc(t.historicoPrecos.coletadoEm), desc(t.historicoPrecos.id));
  // A observação mais recente é o preço atual: fica fora da mediana.
  const anteriores = obs.slice(1).map((o) => ({ preco: Number(o.preco), coletadoEm: o.coletadoEm }));
  const avaliacao = avaliarOferta(
    {
      preco: Number(produto.precoAtual),
      avaliacao: n(produto.avaliacao),
      vendas: produto.vendas,
      comissaoTaxa: n(produto.comissaoTaxa),
    },
    anteriores,
    regrasDoNicho(nicho, base),
  );
  if (!avaliacao.ok) return { criada: false, motivo: avaliacao.motivo, avaliacao };
  const [aberta] = await db
    .select({ id: t.ofertas.id })
    .from(t.ofertas)
    .where(
      and(
        eq(t.ofertas.produtoId, produtoId),
        inArray(t.ofertas.status, ["candidata", "aprovada", "agendada"]),
      ),
    );
  if (aberta) return { criada: false, motivo: "oferta_ja_aberta", ofertaId: aberta.id, avaliacao };
  return db.transaction(async (x) => {
    const [oferta] = await x
      .insert(t.ofertas)
      .values({
        produtoId,
        nichoId: produto.nichoId,
        preco: produto.precoAtual as string,
        medianaPreco30d: String(avaliacao.mediana),
        descontoPct: String(avaliacao.descontoPct),
        comissaoTaxa: produto.comissaoTaxa,
        pontuacao: String(avaliacao.pontuacao),
        status: "candidata",
      })
      // O índice único parcial impede duas ofertas abertas para o mesmo produto, mesmo em corrida.
      .onConflictDoNothing()
      .returning({ id: t.ofertas.id });
    if (!oferta) return { criada: false as const, motivo: "oferta_ja_aberta", avaliacao };
    await registrarEvento(x, {
      tipo: "oferta_detectada",
      agente,
      ofertaId: oferta.id,
      dados: {
        produtoId,
        nome: produto.nome,
        preco: Number(produto.precoAtual),
        mediana30d: avaliacao.mediana,
        descontoPct: avaliacao.descontoPct,
        pontuacao: avaliacao.pontuacao,
      },
    });
    return { criada: true as const, ofertaId: oferta.id, avaliacao };
  });
}

export async function listarOfertas(db: Db, f: { status?: string; nichoId?: number; limite: number }) {
  const conds = [];
  if (f.status) conds.push(eq(t.ofertas.status, f.status as (typeof t.ofertas.$inferSelect)["status"]));
  if (f.nichoId) conds.push(eq(t.ofertas.nichoId, f.nichoId));
  const linhas = await db
    .select({
      id: t.ofertas.id,
      status: t.ofertas.status,
      preco: t.ofertas.preco,
      mediana30d: t.ofertas.medianaPreco30d,
      descontoPct: t.ofertas.descontoPct,
      comissaoTaxa: t.ofertas.comissaoTaxa,
      pontuacao: t.ofertas.pontuacao,
      criadoEm: t.ofertas.criadoEm,
      nichoId: t.ofertas.nichoId,
      produto: {
        id: t.produtos.id,
        nome: t.produtos.nome,
        marketplace: t.produtos.marketplace,
        idExterno: t.produtos.idExterno,
        fotoUrl: t.produtos.fotoUrl,
        linkAfiliado: t.produtos.linkAfiliado,
        url: t.produtos.url,
        avaliacao: t.produtos.avaliacao,
        vendas: t.produtos.vendas,
      },
    })
    .from(t.ofertas)
    .innerJoin(t.produtos, eq(t.produtos.id, t.ofertas.produtoId))
    .where(conds.length ? and(...conds) : undefined)
    // As de maior pontuação saem primeiro (T2.7).
    .orderBy(sql`${t.ofertas.pontuacao} desc nulls last`, desc(t.ofertas.criadoEm))
    .limit(f.limite);
  return linhas.map((l) => ({
    ...l,
    preco: Number(l.preco),
    mediana30d: n(l.mediana30d),
    descontoPct: n(l.descontoPct),
    comissaoTaxa: n(l.comissaoTaxa),
    pontuacao: n(l.pontuacao),
    criadoEm: l.criadoEm.toISOString(),
    produto: { ...l.produto, avaliacao: n(l.produto.avaliacao) },
  }));
}

export async function historicoPrecos(db: Db, produtoId: number, dias: number) {
  const [produto] = await db
    .select({ id: t.produtos.id, nome: t.produtos.nome, precoAtual: t.produtos.precoAtual })
    .from(t.produtos)
    .where(eq(t.produtos.id, produtoId));
  if (!produto) throw new ErroNegocio(404, "produto_nao_encontrado", "produto não encontrado");
  const desde = new Date(Date.now() - dias * 86_400_000);
  const obs = await db
    .select({
      preco: t.historicoPrecos.preco,
      precoOriginal: t.historicoPrecos.precoOriginal,
      emEstoque: t.historicoPrecos.emEstoque,
      coletadoEm: t.historicoPrecos.coletadoEm,
    })
    .from(t.historicoPrecos)
    .where(and(eq(t.historicoPrecos.produtoId, produtoId), gte(t.historicoPrecos.coletadoEm, desde)))
    .orderBy(asc(t.historicoPrecos.coletadoEm));
  const precos = obs.map((o) => Number(o.preco)).sort((a, b) => a - b);
  const meio = Math.floor(precos.length / 2);
  const med =
    precos.length === 0
      ? null
      : precos.length % 2
        ? precos[meio]
        : ((precos[meio - 1] as number) + (precos[meio] as number)) / 2;
  return {
    produto: { id: produto.id, nome: produto.nome, precoAtual: n(produto.precoAtual) },
    dias,
    mediana: med ?? null,
    observacoes: obs.map((o) => ({
      preco: Number(o.preco),
      precoOriginal: n(o.precoOriginal),
      emEstoque: o.emEstoque,
      coletadoEm: o.coletadoEm.toISOString(),
    })),
  };
}

// ---------- Monitor (T2.3) ----------

export interface ResultadoMonitor {
  buscas: number;
  atualizadosPorBusca: number;
  atualizadosPorDetalhe: number;
  removidos: number;
  falhas: number;
  ofertas: number;
}

/**
 * Atualiza preço e estoque dos produtos acompanhados e grava o histórico.
 * 1) Refaz as buscas dos nichos ativos (uma chamada traz até 50 produtos: barato).
 * 2) Consulta um a um, até `maxDetalhes`, os acompanhados que a busca não trouxe nesta rodada.
 * 3) Avalia cada produto atualizado e cria as ofertas candidatas.
 */
export async function rodarMonitor(
  db: Db,
  adapter: MarketplaceAdapter,
  opcoes: { maxDetalhes?: number; regras?: RegrasOferta; agente?: string } = {},
): Promise<ResultadoMonitor> {
  const agente = opcoes.agente ?? "Monitor";
  const inicio = new Date();
  const r: ResultadoMonitor = {
    buscas: 0,
    atualizadosPorBusca: 0,
    atualizadosPorDetalhe: 0,
    removidos: 0,
    falhas: 0,
    ofertas: 0,
  };
  const atualizados = new Set<number>();

  const nichos = (await listarNichos(db)).filter((x) => x.ativo && x.marketplace === adapter.nome);
  for (const nicho of nichos) {
    for (const termo of nicho.palavras) {
      try {
        const lista = await adapter.buscar(termo, {
          precoMin: n(nicho.precoMin),
          precoMax: n(nicho.precoMax),
          limite: 50,
        });
        r.buscas++;
        for (const p of lista) {
          // Só atualiza quem já é acompanhado; produto novo entra pela coleta.
          const [existente] = await db
            .select({ id: t.produtos.id, acompanhado: t.produtos.acompanhado })
            .from(t.produtos)
            .where(and(eq(t.produtos.marketplace, p.marketplace), eq(t.produtos.idExterno, p.idExterno)));
          if (!existente?.acompanhado || atualizados.has(existente.id)) continue;
          await db.transaction(async (x) => {
            await gravarProduto(x, p, nicho.id);
            await gravarObservacao(x, existente.id, p.preco, p.precoMax, p.emEstoque);
          });
          atualizados.add(existente.id);
          r.atualizadosPorBusca++;
        }
      } catch {
        r.falhas++;
      }
    }
  }

  const pendentes = await db
    .select({
      id: t.produtos.id,
      idExterno: t.produtos.idExterno,
      lojaId: t.produtos.lojaId,
      nichoId: t.produtos.nichoId,
    })
    .from(t.produtos)
    .where(
      and(
        eq(t.produtos.acompanhado, true),
        eq(t.produtos.marketplace, adapter.nome),
        or(isNull(t.produtos.ultimaColetaEm), lt(t.produtos.ultimaColetaEm, inicio)),
      ),
    )
    .orderBy(sql`${t.produtos.ultimaColetaEm} asc nulls first`)
    .limit(opcoes.maxDetalhes ?? 100);
  for (const p of pendentes) {
    if (atualizados.has(p.id)) continue;
    try {
      const d = await (
        adapter.detalhe as (
          id: string,
          ctx?: { lojaId?: string | null },
        ) => Promise<ProdutoMarketplace | null>
      )(p.idExterno, { lojaId: p.lojaId });
      if (!d) {
        // Sumiu do marketplace: para de acompanhar e marca sem estoque.
        await db
          .update(t.produtos)
          .set({ acompanhado: false, emEstoque: false, atualizadoEm: new Date() })
          .where(eq(t.produtos.id, p.id));
        r.removidos++;
        continue;
      }
      await db.transaction(async (x) => {
        await gravarProduto(x, d, p.nichoId);
        await gravarObservacao(x, p.id, d.preco, d.precoMax, d.emEstoque);
      });
      atualizados.add(p.id);
      r.atualizadosPorDetalhe++;
    } catch {
      r.falhas++;
    }
  }

  for (const id of atualizados) {
    const d = await detectarOferta(db, id, opcoes.regras ?? REGRAS_PADRAO, agente);
    if (d.criada) r.ofertas++;
  }
  await registrarEvento(db, { tipo: "monitor.concluido", agente, dados: { ...r } });
  return r;
}

export async function listarProdutos(db: Db, f: { nichoId?: number; limite: number; pagina: number }) {
  const cond = f.nichoId ? eq(t.produtos.nichoId, f.nichoId) : undefined;
  const [tot] = await db
    .select({
      total: sql<number>`count(*)::int`,
      comLink: sql<number>`count(${t.produtos.linkAfiliado})::int`,
      acompanhados: sql<number>`count(*) filter (where ${t.produtos.acompanhado})::int`,
    })
    .from(t.produtos)
    .where(cond);
  const linhas = await db
    .select()
    .from(t.produtos)
    .where(cond)
    .orderBy(desc(t.produtos.vendas), asc(t.produtos.id))
    .limit(f.limite)
    .offset((f.pagina - 1) * f.limite);
  return {
    total: tot?.total ?? 0,
    comLinkAfiliado: tot?.comLink ?? 0,
    acompanhados: tot?.acompanhados ?? 0,
    produtos: linhas.map((p) => ({
      id: p.id,
      marketplace: p.marketplace,
      idExterno: p.idExterno,
      nome: p.nome,
      lojaNome: p.lojaNome,
      preco: n(p.precoAtual),
      avaliacao: n(p.avaliacao),
      vendas: p.vendas,
      comissaoTaxa: n(p.comissaoTaxa),
      linkAfiliado: p.linkAfiliado,
      url: p.url,
      fotoUrl: p.fotoUrl,
      acompanhado: p.acompanhado,
      nichoId: p.nichoId,
      ultimaColetaEm: p.ultimaColetaEm?.toISOString() ?? null,
    })),
  };
}
