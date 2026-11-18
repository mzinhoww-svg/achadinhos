import { randomUUID } from "node:crypto";
import { baixarFoto, ErroArte, type Formato, gerarArte, templateDoNicho } from "@achadinhos/arte";
import { type Db, tabelas as t } from "@achadinhos/db";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { ErroNegocio, lerDoc, registrarEvento } from "../servicos.js";
import type { Armazenamento } from "./armazenamento.js";

export interface PedidoRender {
  ofertaId?: number;
  produtoId?: number;
  formatos: Formato[];
  forcarFallback?: boolean;
  agente?: string;
}

export interface OpcoesArte {
  armazenamento: Armazenamento;
  baseUrl: string;
  limiarConfianca: number;
  f?: typeof fetch;
}

const n = (v: string | null | undefined) => (v == null ? null : Number(v));

/** Uma renderização por vez: segura a memória do worker (sharp + Satori em 1080 px). */
let fila: Promise<unknown> = Promise.resolve();
function emSerie<T>(tarefa: () => Promise<T>): Promise<T> {
  const r = fila.then(tarefa, tarefa);
  fila = r.catch(() => {});
  return r;
}

/** Preço da peça: na oferta, a mediana de 30 dias é o "de"; na prévia, o preço cheio anunciado pela loja. */
async function dadosDoPedido(db: Db, p: PedidoRender) {
  if (p.ofertaId) {
    const [l] = await db
      .select({ oferta: t.ofertas, produto: t.produtos, nicho: t.nichos.nome })
      .from(t.ofertas)
      .innerJoin(t.produtos, eq(t.produtos.id, t.ofertas.produtoId))
      .leftJoin(t.nichos, eq(t.nichos.id, sql`coalesce(${t.ofertas.nichoId}, ${t.produtos.nichoId})`))
      .where(eq(t.ofertas.id, p.ofertaId));
    if (!l) throw new ErroNegocio(404, "nao_encontrado", `oferta ${p.ofertaId} não existe`);
    const preco = Number(l.oferta.preco);
    const mediana = n(l.oferta.medianaPreco30d);
    return {
      produto: l.produto,
      ofertaId: l.oferta.id,
      nicho: l.nicho,
      preco,
      precoAntigo: mediana && mediana > preco ? mediana : null,
      descontoPct: n(l.oferta.descontoPct),
      origemPreco: "oferta" as const,
    };
  }
  const [l] = await db
    .select({ produto: t.produtos, nicho: t.nichos.nome })
    .from(t.produtos)
    .leftJoin(t.nichos, eq(t.nichos.id, t.produtos.nichoId))
    .where(eq(t.produtos.id, p.produtoId ?? 0));
  if (!l) throw new ErroNegocio(404, "nao_encontrado", `produto ${p.produtoId} não existe`);
  const preco = n(l.produto.precoAtual);
  if (!preco) throw new ErroNegocio(422, "sem_preco", "o produto ainda não tem preço coletado");
  const cheio = n(l.produto.precoMax);
  const anunciado = n(l.produto.descontoAnunciado);
  let precoAntigo: number | null = cheio && cheio > preco ? cheio : null;
  if (!precoAntigo && anunciado && anunciado > 0 && anunciado < 0.95)
    precoAntigo = Math.round((preco / (1 - anunciado)) * 100) / 100;
  const descontoPct = precoAntigo ? Math.round((1 - preco / precoAntigo) * 10000) / 100 : null;
  return {
    produto: l.produto,
    ofertaId: null,
    nicho: l.nicho,
    preco,
    precoAntigo,
    descontoPct,
    origemPreco: "previa" as const,
  };
}

/** T3.1 a T3.7: baixa a foto oficial, recorta, padroniza, aplica o template e guarda as peças. */
export function renderizar(db: Db, p: PedidoRender, o: OpcoesArte) {
  return emSerie(() => renderizarAgora(db, p, o));
}

async function renderizarAgora(db: Db, p: PedidoRender, o: OpcoesArte) {
  const d = await dadosDoPedido(db, p);
  if (!d.produto.fotoUrl) throw new ErroNegocio(422, "sem_foto", "o produto não tem foto oficial");
  let foto: Awaited<ReturnType<typeof baixarFoto>>;
  try {
    foto = await baixarFoto(d.produto.fotoUrl, o.f);
  } catch (e) {
    if (e instanceof ErroArte) throw new ErroNegocio(502, "foto_indisponivel", e.message);
    throw e;
  }
  const docTemplates = await lerDoc(db, "TEMPLATES-VISUAIS");
  const tpl = templateDoNicho(docTemplates?.conteudo, d.nicho);
  const arte = await gerarArte({
    foto: foto.buffer,
    formatos: p.formatos,
    template: tpl.template,
    preco: d.preco,
    precoAntigo: d.precoAntigo,
    descontoPct: d.descontoPct,
    limiarConfianca: o.limiarConfianca,
    ...(p.forcarFallback ? { forcarFallback: true } : {}),
  });

  const lote = `${new Date().toISOString().slice(0, 10)}/${d.produto.id}-${randomUUID().slice(0, 8)}`;
  const mascaraUrl = arte.mascara
    ? await o.armazenamento.gravar(`${lote}/mascara.png`, arte.mascara, "image/png", o.baseUrl)
    : null;
  const pecas: { id: number; formato: Formato; url: string; largura: number; altura: number }[] = [];
  for (const peca of arte.pecas) {
    const url = await o.armazenamento.gravar(
      `${lote}/${peca.formato}.jpg`,
      peca.jpeg,
      "image/jpeg",
      o.baseUrl,
    );
    const [linha] = await db
      .insert(t.imagens)
      .values({
        ofertaId: d.ofertaId,
        produtoId: d.produto.id,
        formato: peca.formato,
        template: tpl.origem,
        fotoOriginalUrl: foto.url,
        url,
        mascaraUrl,
        recorteOk: !arte.fallback,
        confianca: arte.confianca.toFixed(2),
        fallback: arte.fallback,
        motivoFallback: arte.motivoFallback,
        ampliada: arte.ampliada,
        preco: d.preco.toFixed(2),
        precoAntigo: d.precoAntigo?.toFixed(2) ?? null,
        descontoPct: d.descontoPct?.toFixed(2) ?? null,
        origemPreco: d.origemPreco,
      })
      .returning({ id: t.imagens.id });
    pecas.push({
      id: linha?.id ?? 0,
      formato: peca.formato,
      url,
      largura: peca.largura,
      altura: peca.altura,
    });
  }

  const resultado = {
    produtoId: d.produto.id,
    ofertaId: d.ofertaId,
    origemPreco: d.origemPreco,
    fotoOriginalUrl: foto.url,
    fotoOriginal: { largura: foto.largura, altura: foto.altura },
    pecas,
    mascaraUrl,
    confianca: arte.confianca,
    fallback: arte.fallback,
    motivoFallback: arte.motivoFallback,
    ampliada: arte.ampliada,
    fatorAmpliacao: arte.fatorAmpliacao,
    template: tpl.origem,
    avisoTemplate: tpl.aviso,
    armazenamento: o.armazenamento.nome,
  };
  await registrarEvento(db, {
    tipo: arte.fallback ? "arte.fallback" : "arte.renderizada",
    agente: p.agente ?? "Diretor de Arte",
    ...(d.ofertaId ? { ofertaId: d.ofertaId } : {}),
    dados: {
      produtoId: d.produto.id,
      formatos: p.formatos,
      confianca: arte.confianca,
      ...(arte.motivoFallback ? { motivo: arte.motivoFallback } : {}),
      ...(tpl.aviso ? { avisoTemplate: tpl.aviso } : {}),
    },
  });
  return resultado;
}

/**
 * Lote para a conferência: as ofertas abertas do nicho primeiro, depois os produtos com mais desconto
 * anunciado. Só produtos com foto.
 */
export async function escolherLote(db: Db, nichoId: number | undefined, limite: number) {
  const filtroNicho = nichoId ? eq(t.produtos.nichoId, nichoId) : undefined;
  const ofertas = await db
    .select({ ofertaId: t.ofertas.id, produtoId: t.ofertas.produtoId })
    .from(t.ofertas)
    .innerJoin(t.produtos, eq(t.produtos.id, t.ofertas.produtoId))
    .where(
      and(
        sql`${t.ofertas.status} in ('candidata','aprovada','agendada')`,
        isNotNull(t.produtos.fotoUrl),
        filtroNicho,
      ),
    )
    .orderBy(desc(t.ofertas.pontuacao))
    .limit(limite);
  const usados = new Set(ofertas.map((x) => x.produtoId));
  const faltam = limite - ofertas.length;
  const produtos =
    faltam > 0
      ? await db
          .select({ produtoId: t.produtos.id })
          .from(t.produtos)
          .where(and(isNotNull(t.produtos.fotoUrl), isNotNull(t.produtos.precoAtual), filtroNicho))
          .orderBy(sql`${t.produtos.descontoAnunciado} desc nulls last`, desc(t.produtos.vendas))
          .limit(limite + usados.size)
      : [];
  return [
    ...ofertas.map((x) => ({ ofertaId: x.ofertaId })),
    ...produtos
      .filter((x) => !usados.has(x.produtoId))
      .slice(0, Math.max(0, faltam))
      .map((x) => ({ produtoId: x.produtoId })),
  ];
}

/** Peças para a página de conferência: agrupadas por renderização (mesma foto e mesmo instante). */
export async function listarImagens(db: Db, q: { ofertaId?: number; produtoId?: number; limite: number }) {
  const linhas = await db
    .select({
      imagem: t.imagens,
      produto: {
        id: t.produtos.id,
        nome: t.produtos.nome,
        url: t.produtos.url,
        idExterno: t.produtos.idExterno,
      },
    })
    .from(t.imagens)
    .innerJoin(t.produtos, eq(t.produtos.id, t.imagens.produtoId))
    .where(
      and(
        q.ofertaId ? eq(t.imagens.ofertaId, q.ofertaId) : undefined,
        q.produtoId ? eq(t.imagens.produtoId, q.produtoId) : undefined,
      ),
    )
    .orderBy(desc(t.imagens.id))
    .limit(q.limite * 2);
  const grupos = new Map<string, ReturnType<typeof grupoVazio>>();
  function grupoVazio(l: (typeof linhas)[number]) {
    const i = l.imagem;
    return {
      chave: i.mascaraUrl ?? `${i.produtoId}-${i.criadoEm.toISOString().slice(0, 19)}`,
      produto: l.produto,
      ofertaId: i.ofertaId,
      origemPreco: i.origemPreco,
      fotoOriginalUrl: i.fotoOriginalUrl,
      mascaraUrl: i.mascaraUrl,
      confianca: n(i.confianca),
      fallback: i.fallback,
      motivoFallback: i.motivoFallback,
      ampliada: i.ampliada,
      template: i.template,
      preco: n(i.preco),
      precoAntigo: n(i.precoAntigo),
      descontoPct: n(i.descontoPct),
      criadoEm: i.criadoEm.toISOString(),
      pecas: [] as { id: number; formato: string; url: string | null }[],
    };
  }
  for (const l of linhas) {
    const g = grupoVazio(l);
    const existente = grupos.get(g.chave) ?? g;
    existente.pecas.push({ id: l.imagem.id, formato: l.imagem.formato, url: l.imagem.url });
    grupos.set(g.chave, existente);
  }
  const lista = [...grupos.values()].slice(0, q.limite);
  for (const g of lista) g.pecas.sort((a, b) => a.formato.localeCompare(b.formato));
  return lista;
}
