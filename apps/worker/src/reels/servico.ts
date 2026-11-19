import { baixarFoto, gerarReel, gerarReelDeVideo, MODELOS_REEL, type ModeloReel } from "@achadinhos/arte";
import { type Db, tabelas as t } from "@achadinhos/db";
import type { MarketplaceAdapter } from "@achadinhos/marketplace";
import { and, asc, desc, eq, gte, inArray, isNotNull, like, lt, ne, notInArray, sql } from "drizzle-orm";
import type { Armazenamento } from "../arte/armazenamento.js";
import { nomeCurto, palavrasDoNome } from "../ciclo/copy.js";
import { diaBrt, horarioBrt } from "../ciclo/disparo.js";
import { novoCodigo } from "../ciclo/links.js";
import { ErroNegocio, registrarEvento } from "../servicos.js";

/**
 * Reels do Instagram (distribuição) → DM com o link de afiliado e o convite do grupo.
 * Fonte padrão: o vídeo oficial da página do produto na Shopee, coletado no Mac do Aurimar (openbot/coletor-video).
 * Sem vídeo até 1 h antes do horário, o Reel sai das fotos reais (reserva), para a agenda nunca travar.
 */

export interface DepsReels {
  db: Db;
  marketplace: MarketplaceAdapter | null;
  armazenamento: Armazenamento;
  baseUrl: string;
  painelUrl: string;
  marca?: string;
  f?: typeof fetch;
}

let fila: Promise<unknown> = Promise.resolve();
function emSerie<T>(tarefa: () => Promise<T>): Promise<T> {
  const r = fila.then(tarefa, tarefa);
  fila = r.catch(() => {});
  return r;
}

/** Palavra para comentar: a primeira palavra forte do nome, sem acento, em maiúsculas; número se já estiver em uso. */
export function escolherPalavra(nome: string, usadas: Set<string>): string {
  const base = (palavrasDoNome(nome)[0] ?? "ACHADO").toUpperCase().slice(0, 12);
  if (!usadas.has(base)) return base;
  for (let i = 2; i < 100; i++) if (!usadas.has(`${base}${i}`)) return `${base}${i}`;
  return `${base}${Date.now() % 1000}`;
}

/** Horários do dia entre 08:00 e 22:00 (Brasília), igualmente espaçados. */
export function horariosDoDia(dia: string, quantidade: number, depoisDe: Date): Date[] {
  const ini = horarioBrt(dia, "08:00").getTime();
  const fim = horarioBrt(dia, "22:00").getTime();
  const passo = Math.floor((fim - ini) / Math.max(1, quantidade));
  const todos = Array.from({ length: quantidade }, (_, i) => new Date(ini + i * passo));
  const futuros = todos.filter((d) => d.getTime() > depoisDe.getTime() + 20 * 60_000);
  if (futuros.length === todos.length) return todos;
  // Dia já começou: espalha o que falta entre agora (+20 min) e 22:00.
  const inicio = Math.max(ini, depoisDe.getTime() + 20 * 60_000);
  const p2 = Math.floor((fim - inicio) / Math.max(1, quantidade));
  return Array.from({ length: quantidade }, (_, i) => new Date(inicio + i * p2)).filter(
    (d) => d.getTime() <= fim,
  );
}

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Link do grupo para a DM: o grupo real ativo com link de entrada; sem ele, o de teste. */
async function linkDoGrupo(db: Db): Promise<string | null> {
  const grupos = await db
    .select()
    .from(t.grupos)
    .where(and(eq(t.grupos.ativo, true), isNotNull(t.grupos.linkEntrada)));
  return (grupos.find((g) => !g.teste) ?? grupos[0])?.linkEntrada ?? null;
}

/** Escolhe até `quantidade` produtos para o dia e cria os Reels na fila (vídeo pendente). */
export async function planejarReels(d: DepsReels, o: { quantidade: number; agora?: Date; agente?: string }) {
  const agora = o.agora ?? new Date();
  const dia = diaBrt(agora);
  const jaHoje = await d.db.select({ id: t.reels.id }).from(t.reels).where(eq(t.reels.dia, dia));
  const faltam = o.quantidade - jaHoje.length;
  if (faltam <= 0) return { dia, criados: 0, motivo: `já há ${jaHoje.length} Reels planejados hoje` };
  const recentes = await d.db
    .select({ produtoId: t.reels.produtoId })
    .from(t.reels)
    .where(gte(t.reels.criadoEm, new Date(agora.getTime() - 14 * 86_400_000)));
  const excluir = recentes.map((r) => r.produtoId);
  // Ofertas reais abertas primeiro; depois os mais vendidos dos nichos ativos.
  const candidatos = await d.db
    .select({ produto: t.produtos, nicho: t.nichos })
    .from(t.produtos)
    .innerJoin(t.nichos, eq(t.nichos.id, t.produtos.nichoId))
    .where(
      and(
        eq(t.nichos.ativo, true),
        ne(t.produtos.marketplace, "fake"),
        isNotNull(t.produtos.fotoUrl),
        isNotNull(t.produtos.precoAtual),
        sql`coalesce(${t.produtos.emEstoque}, true)`,
        sql`coalesce(${t.produtos.avaliacao}, 0) >= ${t.nichos.avaliacaoMin}`,
        excluir.length ? notInArray(t.produtos.id, excluir) : undefined,
      ),
    )
    .orderBy(
      sql`(select count(*) from ${t.ofertas} o where o.produto_id = ${t.produtos.id} and o.status in ('candidata','aprovada','agendada','enviada')) desc`,
      sql`${t.produtos.vendas} desc nulls last`,
    )
    .limit(faltam);
  const usadas = new Set(
    (
      await d.db
        .select({ p: t.reels.palavra })
        .from(t.reels)
        .where(gte(t.reels.criadoEm, new Date(agora.getTime() - 14 * 86_400_000)))
    ).map((x) => x.p),
  );
  const horarios = horariosDoDia(dia, faltam, agora);
  const grupo = await linkDoGrupo(d.db);
  const criados = [];
  for (const [i, { produto }] of candidatos.entries()) {
    const [oferta] = await d.db
      .select()
      .from(t.ofertas)
      .where(
        and(
          eq(t.ofertas.produtoId, produto.id),
          inArray(t.ofertas.status, ["candidata", "aprovada", "agendada", "enviada"]),
        ),
      )
      .orderBy(desc(t.ofertas.id))
      .limit(1);
    const preco = oferta ? Number(oferta.preco) : Number(produto.precoAtual);
    const mediana = oferta?.medianaPreco30d ? Number(oferta.medianaPreco30d) : null;
    const desconto = oferta?.descontoPct ? Number(oferta.descontoPct) : null;
    const palavra = escolherPalavra(produto.nome, usadas);
    usadas.add(palavra);
    const modelo = MODELOS_REEL[(jaHoje.length + i) % MODELOS_REEL.length] as ModeloReel;
    const [reel] = await d.db
      .insert(t.reels)
      .values({
        produtoId: produto.id,
        ofertaId: oferta?.id ?? null,
        palavra,
        modelo,
        dia,
        agendadoPara: horarios[i] ?? null,
        status: "video_pendente",
      })
      .returning();
    if (!reel) continue;
    // Link de afiliado próprio do Reel: subIds ig, reel, modelo, nicho e o código curto.
    const codigo = novoCodigo();
    const subIds = {
      origem: "ig",
      reel: `r${reel.id}`,
      modelo: modelo.slice(0, 8),
      nicho: `n${produto.nichoId ?? 0}`,
      codigo,
    };
    let url = produto.linkAfiliado ?? produto.url;
    if (d.marketplace && produto.marketplace === d.marketplace.nome) {
      url = await d.marketplace.gerarLinkAfiliado(produto.url, Object.values(subIds)).catch(() => url);
    }
    const [link] = await d.db
      .insert(t.links)
      .values({
        ofertaId: oferta?.id ?? null,
        produtoId: produto.id,
        origem: "instagram",
        reelId: reel.id,
        urlAfiliado: url,
        codigoCurto: codigo,
        subIds,
      })
      .returning({ id: t.links.id });
    const curto = `${d.painelUrl.replace(/\/$/, "")}/r/${codigo}`;
    const nome = nomeCurto(produto.nome);
    const legenda = [
      oferta && desconto ? `${nome}: ${Math.round(desconto)}% abaixo do preço médio 👀` : `${nome} 👀`,
      "",
      `💰 ${brl(preco)}${mediana && mediana > preco ? ` (antes ${brl(mediana)})` : ""}`,
      "",
      `Comente ${palavra} que eu te mando o link no direct 📩`,
      "",
      "#achadinhos #achadosdacasa #publi",
    ].join("\n");
    const dm = [
      `Aqui está o link do ${nome}: ${curto}`,
      grupo ? `\nE entra no nosso grupo de ofertas no WhatsApp: ${grupo}` : "",
      "\n#publi · link de afiliado",
    ].join("");
    await d.db
      .update(t.reels)
      .set({ linkId: link?.id ?? null, legenda, dmTexto: dm })
      .where(eq(t.reels.id, reel.id));
    criados.push({
      id: reel.id,
      produto: nome,
      palavra,
      modelo,
      agendadoPara: reel.agendadoPara?.toISOString() ?? null,
    });
  }
  await registrarEvento(d.db, {
    tipo: "reels.planejados",
    agente: o.agente ?? "Diretor de Vídeo",
    dados: { dia, criados: criados.length, semGrupo: !grupo },
  });
  return {
    dia,
    criados: criados.length,
    reels: criados,
    avisoGrupo: grupo ? null : "nenhum grupo com link de entrada: a DM vai sem o convite",
  };
}

async function dadosDoReel(db: Db, id: number) {
  const [l] = await db
    .select({ reel: t.reels, produto: t.produtos, oferta: t.ofertas })
    .from(t.reels)
    .innerJoin(t.produtos, eq(t.produtos.id, t.reels.produtoId))
    .leftJoin(t.ofertas, eq(t.ofertas.id, t.reels.ofertaId))
    .where(eq(t.reels.id, id));
  if (!l) throw new ErroNegocio(404, "nao_encontrado", `reel ${id} não existe`);
  return l;
}

function entradaDoReel(l: Awaited<ReturnType<typeof dadosDoReel>>, marca: string) {
  const preco = l.oferta ? Number(l.oferta.preco) : Number(l.produto.precoAtual);
  const mediana = l.oferta?.medianaPreco30d ? Number(l.oferta.medianaPreco30d) : null;
  return {
    titulo: nomeCurto(l.produto.nome),
    preco,
    precoAntigo: mediana && mediana > preco ? mediana : null,
    descontoPct: l.oferta?.descontoPct ? Number(l.oferta.descontoPct) : null,
    palavra: l.reel.palavra,
    marca,
    modelo: l.reel.modelo as ModeloReel,
  };
}

async function guardar(d: DepsReels, id: number, mp4: Buffer, capa: Buffer, fonte: "video" | "fotos") {
  const pasta = `reels/${diaBrt(new Date())}/${id}-${novoCodigo(5)}`;
  const reelUrl = await d.armazenamento.gravar(`${pasta}/reel.mp4`, mp4, "video/mp4", d.baseUrl);
  const capaUrl = await d.armazenamento.gravar(`${pasta}/capa.jpg`, capa, "image/jpeg", d.baseUrl);
  await d.db
    .update(t.reels)
    .set({ status: "pronto", fonte, reelUrl, capaUrl, erro: null })
    .where(eq(t.reels.id, id));
  await registrarEvento(d.db, {
    tipo: "reel.pronto",
    agente: "Diretor de Vídeo",
    dados: { reelId: id, fonte, mb: Math.round(mp4.length / 10485.76) / 100 },
  });
  return { id, status: "pronto", fonte, reelUrl, capaUrl };
}

/** Vídeo coletado da página da Shopee (Mac) → Reel montado e guardado. */
export function receberVideo(d: DepsReels, id: number, video: Buffer) {
  return emSerie(async () => {
    const l = await dadosDoReel(d.db, id);
    if (!["video_pendente", "pronto"].includes(l.reel.status))
      throw new ErroNegocio(409, "reel_em_andamento", `reel está ${l.reel.status}`);
    try {
      const r = await gerarReelDeVideo({ ...entradaDoReel(l, d.marca ?? "Achadinhos"), video });
      return await guardar(d, id, r.mp4, r.capa, "video");
    } catch (e) {
      throw new ErroNegocio(
        422,
        "video_invalido",
        `não deu para montar o Reel com esse vídeo: ${(e as Error).message.slice(0, 200)}`,
      );
    }
  });
}

/** Reserva: Reel das fotos reais (sem vídeo na página, ou o coletor não chegou a tempo). */
export function reelDeFotos(d: DepsReels, id: number) {
  return emSerie(async () => {
    const l = await dadosDoReel(d.db, id);
    if (!l.produto.fotoUrl) throw new ErroNegocio(422, "sem_foto", "o produto não tem foto");
    const foto = await baixarFoto(l.produto.fotoUrl, d.f);
    const r = await gerarReel({ ...entradaDoReel(l, d.marca ?? "Achadinhos"), fotos: [foto.buffer] });
    return guardar(d, id, r.mp4, r.capa, "fotos");
  });
}

/** Para o coletor do Mac: Reels que ainda esperam o vídeo, os mais próximos do horário primeiro. */
export async function pendentesDeVideo(db: Db, limite = 40) {
  return db
    .select({
      id: t.reels.id,
      palavra: t.reels.palavra,
      agendadoPara: t.reels.agendadoPara,
      url: t.produtos.url,
      nome: t.produtos.nome,
      idExterno: t.produtos.idExterno,
      lojaId: t.produtos.lojaId,
    })
    .from(t.reels)
    .innerJoin(t.produtos, eq(t.produtos.id, t.reels.produtoId))
    .where(eq(t.reels.status, "video_pendente"))
    .orderBy(asc(t.reels.agendadoPara))
    .limit(limite);
}

export async function listarReels(db: Db, q: { dia?: string; status?: string; limite: number }) {
  return db
    .select({ reel: t.reels, produto: { id: t.produtos.id, nome: t.produtos.nome, url: t.produtos.url } })
    .from(t.reels)
    .innerJoin(t.produtos, eq(t.produtos.id, t.reels.produtoId))
    .where(
      and(q.dia ? eq(t.reels.dia, q.dia) : undefined, q.status ? eq(t.reels.status, q.status) : undefined),
    )
    .orderBy(asc(t.reels.agendadoPara))
    .limit(q.limite);
}

export async function marcarReel(
  db: Db,
  id: number,
  b: {
    status: "agendado" | "publicado" | "falhou";
    mlabsPostId?: string | undefined;
    mlabsFlowId?: string | undefined;
    agendadoPara?: string | undefined;
    erro?: string | undefined;
  },
  agente: string,
) {
  const [r] = await db
    .update(t.reels)
    .set({
      status: b.status,
      ...(b.mlabsPostId ? { mlabsPostId: b.mlabsPostId } : {}),
      ...(b.mlabsFlowId ? { mlabsFlowId: b.mlabsFlowId } : {}),
      ...(b.agendadoPara ? { agendadoPara: new Date(b.agendadoPara) } : {}),
      erro: b.erro ?? null,
    })
    .where(eq(t.reels.id, id))
    .returning();
  if (!r) throw new ErroNegocio(404, "nao_encontrado", `reel ${id} não existe`);
  await registrarEvento(db, {
    tipo: `reel.${b.status}`,
    agente,
    dados: { reelId: id, palavra: r.palavra, erro: b.erro ?? null },
  });
  return r;
}

/** Job: sem vídeo até 60 min antes do horário → Reel das fotos. Também apaga arquivos de Reels publicados há 3+ dias. */
export async function cuidarDaFila(d: DepsReels, agora = new Date()) {
  const atrasados = await d.db
    .select({ id: t.reels.id })
    .from(t.reels)
    .where(
      and(
        eq(t.reels.status, "video_pendente"),
        lt(t.reels.agendadoPara, new Date(agora.getTime() + 60 * 60_000)),
      ),
    )
    .limit(10);
  let reserva = 0;
  for (const r of atrasados) {
    try {
      await reelDeFotos(d, r.id);
      reserva++;
    } catch (e) {
      await d.db
        .update(t.reels)
        .set({ status: "falhou", erro: (e as Error).message.slice(0, 300) })
        .where(eq(t.reels.id, r.id));
    }
  }
  const velhos = await d.db
    .select({ id: t.reels.id, reelUrl: t.reels.reelUrl })
    .from(t.reels)
    .where(
      and(
        inArray(t.reels.status, ["publicado", "falhou"]),
        lt(t.reels.criadoEm, new Date(agora.getTime() - 3 * 86_400_000)),
      ),
    );
  let apagados = 0;
  if (d.armazenamento.nome === "banco") {
    for (const v of velhos) {
      const m = /\/arquivos\/(reels\/[^/]+\/[^/]+)\//.exec(v.reelUrl ?? "");
      if (!m) continue;
      const r = await d.db
        .delete(t.arquivos)
        .where(like(t.arquivos.caminho, `${m[1]}/%`))
        .returning({ c: t.arquivos.caminho });
      apagados += r.length;
    }
  }
  return { reserva, apagados };
}
