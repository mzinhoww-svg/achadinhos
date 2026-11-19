import { type Db, tabelas as t } from "@achadinhos/db";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { ErroNegocio, registrarEvento } from "../servicos.js";
import { validarCopy } from "./copy.js";
import { lerRegrasChecagem, lerTomDeVoz } from "./regras.js";

export interface MotivoChecagem {
  codigo: string;
  detalhe: string;
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * T5.3: checagem automática. Reprova sozinha a oferta com:
 * - preço atual diferente do preço da oferta;
 * - sem peça, ou peça no fallback com confiança abaixo do mínimo de CHECAGEM.md;
 * - produto repetido dentro do prazo de CHECAGEM.md;
 * - marca, palavra ou nicho bloqueado;
 * - sem copy válida (ou a copy escolhida não passa mais no validador).
 * Aprovada segue direto para o disparo (quem chama agenda).
 */
export async function checarOferta(db: Db, ofertaId: number, agente = "Checagem") {
  const [l] = await db
    .select({ oferta: t.ofertas, produto: t.produtos, nicho: t.nichos.nome })
    .from(t.ofertas)
    .innerJoin(t.produtos, eq(t.produtos.id, t.ofertas.produtoId))
    .leftJoin(t.nichos, eq(t.nichos.id, sql`coalesce(${t.ofertas.nichoId}, ${t.produtos.nichoId})`))
    .where(eq(t.ofertas.id, ofertaId));
  if (!l) throw new ErroNegocio(404, "nao_encontrado", `oferta ${ofertaId} não existe`);
  if (!["candidata", "aprovada", "reprovada"].includes(l.oferta.status)) {
    throw new ErroNegocio(409, "oferta_em_andamento", `oferta está ${l.oferta.status}`);
  }
  const r = await lerRegrasChecagem(db);
  const tom = await lerTomDeVoz(db);
  const motivos: MotivoChecagem[] = [];
  const preco = Number(l.oferta.preco);

  const atual = l.produto.precoAtual ? Number(l.produto.precoAtual) : null;
  if (atual == null || Math.abs(atual - preco) > r.toleranciaPreco)
    motivos.push({
      codigo: "preco_diferente",
      detalhe: `oferta R$ ${preco.toFixed(2)}, agora R$ ${atual?.toFixed(2) ?? "?"}`,
    });
  if (l.produto.emEstoque === false) motivos.push({ codigo: "sem_estoque", detalhe: "produto sem estoque" });

  const [peca] = await db
    .select()
    .from(t.imagens)
    .where(eq(t.imagens.ofertaId, ofertaId))
    .orderBy(desc(t.imagens.id))
    .limit(1);
  if (!peca?.url) motivos.push({ codigo: "sem_imagem", detalhe: "a oferta ainda não tem peça" });
  else if (peca.fallback && Number(peca.confianca ?? 0) < r.fallbackConfiancaMin)
    motivos.push({
      codigo: "imagem_baixa_confianca",
      detalhe: `peça no fallback com confiança ${Number(peca.confianca ?? 0).toFixed(2)} (mínimo ${r.fallbackConfiancaMin})`,
    });
  else if (peca.preco && Math.abs(Number(peca.preco) - preco) > 0.001)
    motivos.push({ codigo: "imagem_preco_antigo", detalhe: "a peça mostra outro preço; renderize de novo" });

  if (r.diasSemRepetir > 0) {
    const desde = new Date(Date.now() - r.diasSemRepetir * 86_400_000);
    const [rep] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(t.envios)
      .innerJoin(t.ofertas, eq(t.ofertas.id, t.envios.ofertaId))
      .where(
        and(
          eq(t.ofertas.produtoId, l.produto.id),
          eq(t.envios.status, "enviado"),
          gte(t.envios.enviadoEm, desde),
        ),
      );
    if ((rep?.n ?? 0) > 0)
      motivos.push({ codigo: "repetido", detalhe: `enviado nos últimos ${r.diasSemRepetir} dias` });
  }

  const nome = semAcento(`${l.produto.nome} ${l.produto.marca ?? ""}`);
  for (const m of r.marcasBloqueadas)
    if (l.produto.marca && semAcento(l.produto.marca) === semAcento(m))
      motivos.push({ codigo: "marca_bloqueada", detalhe: m });
  for (const p of r.palavrasBloqueadas)
    if (nome.includes(semAcento(p))) motivos.push({ codigo: "palavra_bloqueada", detalhe: p });
  if (l.nicho && r.nichosBloqueados.some((n) => semAcento(n) === semAcento(l.nicho ?? "")))
    motivos.push({ codigo: "nicho_bloqueado", detalhe: l.nicho });

  const [copy] = await db
    .select()
    .from(t.copies)
    .where(and(eq(t.copies.ofertaId, ofertaId), eq(t.copies.escolhida, true)))
    .orderBy(desc(t.copies.id))
    .limit(1);
  if (!copy) motivos.push({ codigo: "sem_copy", detalhe: "nenhuma copy válida" });
  else {
    const mediana = l.oferta.medianaPreco30d ? Number(l.oferta.medianaPreco30d) : null;
    const erros = validarCopy(
      copy.texto,
      {
        nome: l.produto.nome,
        preco,
        precoAntigo: mediana && mediana > preco ? mediana : null,
        descontoPct: l.oferta.descontoPct ? Number(l.oferta.descontoPct) : null,
        ensaio: l.oferta.ensaio,
      },
      tom,
    );
    if (erros.length) motivos.push({ codigo: "copy_invalida", detalhe: erros.join("; ") });
  }

  const aprovada = motivos.length === 0;
  await db.insert(t.checagens).values({ ofertaId, aprovada, motivos, agente });
  await db
    .update(t.ofertas)
    .set({
      status: aprovada ? "aprovada" : "reprovada",
      motivoReprovacao: aprovada ? null : motivos.map((m) => m.codigo).join(", "),
    })
    .where(eq(t.ofertas.id, ofertaId));
  await registrarEvento(db, {
    tipo: aprovada ? "checagem.aprovada" : "checagem.reprovada",
    agente,
    ofertaId,
    dados: { motivos },
  });
  return { ofertaId, aprovada, motivos };
}

/** Taxa de reprovação do dia (para a trava de anomalia). */
export async function reprovacaoHoje(db: Db) {
  const inicio = new Date(Date.now() - 3 * 3_600_000);
  inicio.setUTCHours(0, 0, 0, 0);
  const desde = new Date(inicio.getTime() + 3 * 3_600_000);
  const [r] = await db
    .select({
      total: sql<number>`count(*)::int`,
      reprovadas: sql<number>`count(*) filter (where not ${t.checagens.aprovada})::int`,
    })
    .from(t.checagens)
    .innerJoin(t.ofertas, eq(t.ofertas.id, t.checagens.ofertaId))
    .where(and(gte(t.checagens.criadoEm, desde), eq(t.ofertas.ensaio, false)));
  return { total: r?.total ?? 0, reprovadas: r?.reprovadas ?? 0 };
}

export async function listarChecagens(db: Db, limite = 50) {
  return db
    .select({
      id: t.checagens.id,
      ofertaId: t.checagens.ofertaId,
      aprovada: t.checagens.aprovada,
      motivos: t.checagens.motivos,
      agente: t.checagens.agente,
      criadoEm: t.checagens.criadoEm,
      produto: t.produtos.nome,
      ensaio: t.ofertas.ensaio,
    })
    .from(t.checagens)
    .innerJoin(t.ofertas, eq(t.ofertas.id, t.checagens.ofertaId))
    .innerJoin(t.produtos, eq(t.produtos.id, t.ofertas.produtoId))
    .orderBy(desc(t.checagens.id))
    .limit(limite);
}
