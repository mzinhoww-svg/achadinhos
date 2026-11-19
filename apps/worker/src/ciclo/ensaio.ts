import { type Db, tabelas as t } from "@achadinhos/db";
import { and, desc, eq, isNotNull, ne } from "drizzle-orm";
import { ErroNegocio, registrarEvento } from "../servicos.js";

/**
 * Oferta de ensaio: um produto falso (marketplace "fake"), copiado de um produto real já coletado (foto e link
 * reais), com desconto forçado. Passa pelo ciclo inteiro, mas o disparo só manda para grupos de teste.
 * `defeito` força uma reprovação na checagem, para conferir esse caminho.
 */
export async function criarOfertaEnsaio(
  db: Db,
  o: { nichoId?: number; descontoPct?: number; defeito?: "preco" | null } = {},
) {
  const [base] = await db
    .select()
    .from(t.produtos)
    .where(
      and(
        isNotNull(t.produtos.fotoUrl),
        isNotNull(t.produtos.precoAtual),
        ne(t.produtos.marketplace, "fake"),
        o.nichoId ? eq(t.produtos.nichoId, o.nichoId) : undefined,
      ),
    )
    .orderBy(desc(t.produtos.vendas))
    .limit(1);
  if (!base) throw new ErroNegocio(422, "sem_produto_base", "colete produtos reais antes do ensaio");
  const cheio = Number(base.precoAtual);
  const desconto = o.descontoPct ?? 30;
  const preco = Math.max(1, Math.round(cheio * (1 - desconto / 100) * 100) / 100);
  const [produto] = await db
    .insert(t.produtos)
    .values({
      marketplace: "fake",
      idExterno: `ensaio-${Date.now()}`,
      nome: `[ENSAIO] ${base.nome}`.slice(0, 300),
      marca: base.marca,
      url: base.url,
      linkAfiliado: base.linkAfiliado,
      fotoUrl: base.fotoUrl,
      precoAtual: (o.defeito === "preco" ? preco + 5 : preco).toFixed(2),
      avaliacao: base.avaliacao,
      vendas: base.vendas,
      emEstoque: true,
      acompanhado: false,
      nichoId: o.nichoId ?? base.nichoId,
    })
    .returning();
  if (!produto) throw new Error("falha ao criar o produto de ensaio");
  const pct = Math.round((1 - preco / cheio) * 10000) / 100;
  const [oferta] = await db
    .insert(t.ofertas)
    .values({
      produtoId: produto.id,
      nichoId: produto.nichoId,
      preco: preco.toFixed(2),
      medianaPreco30d: cheio.toFixed(2),
      descontoPct: pct.toFixed(2),
      pontuacao: "0",
      ensaio: true,
    })
    .returning();
  if (!oferta) throw new Error("falha ao criar a oferta de ensaio");
  await registrarEvento(db, {
    tipo: "ensaio.criado",
    agente: "worker",
    ofertaId: oferta.id,
    dados: { produtoBase: base.id, preco, descontoPct: pct, defeito: o.defeito ?? null },
  });
  return { ofertaId: oferta.id, produtoId: produto.id, preco, descontoPct: pct, defeito: o.defeito ?? null };
}
