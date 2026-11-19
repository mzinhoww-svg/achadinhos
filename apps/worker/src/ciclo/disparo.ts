import { type Db, tabelas as t } from "@achadinhos/db";
import type { MarketplaceAdapter } from "@achadinhos/marketplace";
import { and, asc, desc, eq, gte, inArray, lte, notExists, sql } from "drizzle-orm";
import type { Armazenamento } from "../arte/armazenamento.js";
import { renderizar } from "../arte/servico.js";
import { ErroNegocio, registrarEvento } from "../servicos.js";
import { checarOferta, reprovacaoHoje } from "./checagem.js";
import { type Alertas, definirPausa, gravarControle, lerControle, lerPausa } from "./controle.js";
import { gerarCopy } from "./copy.js";
import type { Gateway } from "./gateway.js";
import { obterLink } from "./links.js";
import { lerRegrasEnvio, type RegrasEnvio } from "./regras.js";

export interface DepsCiclo {
  db: Db;
  gateway: Gateway | null;
  alertas: Alertas;
  marketplace: MarketplaceAdapter | null;
  painelUrl: string;
  arte: { armazenamento: Armazenamento; baseUrl: string; limiarConfianca: number; f?: typeof fetch };
  openrouterKey?: string | undefined;
  openrouterBaseUrl?: string | undefined;
  fLlm?: typeof fetch;
  agora?: () => Date;
}

const BRT = -3 * 3_600_000;
/** Dia (YYYY-MM-DD) em Brasília. */
export const diaBrt = (d: Date) => new Date(d.getTime() + BRT).toISOString().slice(0, 10);
/** Data/hora "HH:MM" de um dia de Brasília para Date (UTC). */
export function horarioBrt(dia: string, hhmm: string): Date {
  return new Date(Date.parse(`${dia}T${hhmm}:00.000Z`) - BRT);
}

// ---------- agendamento (T5.4) ----------

/**
 * Escolhe o próximo horário livre do grupo:
 * - nos horários de REGRAS-DE-ENVIO (ou os do grupo), um envio normal por horário;
 * - oferta com desconto acima de `extras.descontoMinPct` sai como extra assim que possível (até `extras.max` por dia);
 * - no máximo `maxPorDia` por dia e `intervaloMinMin` minutos entre duas mensagens do grupo.
 */
export function escolherHorario(
  agora: Date,
  ocupados: { em: Date; extra: boolean }[],
  r: RegrasEnvio,
  grupo: { horarios: string[]; maxPorDia: number | null },
  extra: boolean,
): { em: Date; extra: boolean } | null {
  const gap = r.intervaloMinMin * 60_000;
  const horarios = (grupo.horarios.length ? grupo.horarios : r.horarios).slice().sort();
  const maxDia = grupo.maxPorDia ?? r.maxPorDia;
  const noDia = (dia: string) => ocupados.filter((o) => diaBrt(o.em) === dia);
  const livreDoGap = (em: Date) => ocupados.every((o) => Math.abs(o.em.getTime() - em.getTime()) >= gap);
  for (let d = 0; d < 3; d++) {
    const dia = diaBrt(new Date(agora.getTime() + d * 86_400_000));
    const doDia = noDia(dia);
    if (doDia.length >= maxDia) continue;
    if (extra && d === 0 && doDia.filter((o) => o.extra).length < r.extras.max) {
      // o mais cedo possível, respeitando o intervalo
      let em = new Date(agora.getTime() + 60_000);
      for (const o of [...ocupados].sort((a, b) => a.em.getTime() - b.em.getTime())) {
        if (Math.abs(o.em.getTime() - em.getTime()) < gap) em = new Date(o.em.getTime() + gap);
      }
      if (diaBrt(em) === dia) return { em, extra: true };
    }
    for (const h of horarios) {
      const em = horarioBrt(dia, h);
      if (em.getTime() <= agora.getTime()) continue;
      const slotTomado = doDia.some((o) => !o.extra && o.em.getTime() === em.getTime());
      if (!slotTomado && livreDoGap(em)) return { em, extra: false };
    }
  }
  return null;
}

export async function agendarOferta(db: Db, ofertaId: number, agora = new Date()) {
  const [l] = await db
    .select({ oferta: t.ofertas, nichoProduto: t.produtos.nichoId })
    .from(t.ofertas)
    .innerJoin(t.produtos, eq(t.produtos.id, t.ofertas.produtoId))
    .where(eq(t.ofertas.id, ofertaId));
  if (!l) throw new ErroNegocio(404, "nao_encontrado", `oferta ${ofertaId} não existe`);
  if (!["aprovada", "agendada"].includes(l.oferta.status))
    throw new ErroNegocio(409, "nao_aprovada", `oferta está ${l.oferta.status}; só aprovadas são agendadas`);
  const nichoId = l.oferta.nichoId ?? l.nichoProduto;
  const r = await lerRegrasEnvio(db);
  const grupos = nichoId
    ? await db
        .select({ g: t.grupos })
        .from(t.grupos)
        .innerJoin(t.grupoNichos, eq(t.grupoNichos.grupoId, t.grupos.id))
        .where(
          and(
            eq(t.grupoNichos.nichoId, nichoId),
            eq(t.grupos.ativo, true),
            l.oferta.ensaio ? eq(t.grupos.teste, true) : undefined,
          ),
        )
    : [];
  const extra = Number(l.oferta.descontoPct ?? 0) >= r.extras.descontoMinPct;
  const agendados: { grupoId: number; em: string; extra: boolean }[] = [];
  const semHorario: number[] = [];
  for (const { g } of grupos) {
    const chave = `${ofertaId}:${g.id}`;
    const [ja] = await db
      .select({ id: t.envios.id })
      .from(t.envios)
      .where(eq(t.envios.chaveIdempotente, chave));
    if (ja) continue;
    const ocupados = await db
      .select({ em: t.envios.agendadoPara, extra: t.envios.extra })
      .from(t.envios)
      .where(
        and(
          eq(t.envios.grupoId, g.id),
          inArray(t.envios.status, ["agendado", "enviando", "enviado"]),
          gte(t.envios.agendadoPara, new Date(agora.getTime() - 86_400_000)),
        ),
      );
    const h = escolherHorario(
      agora,
      ocupados.filter((o): o is { em: Date; extra: boolean } => o.em !== null),
      r,
      { horarios: g.horarios, maxPorDia: g.maxPorDia },
      extra,
    );
    if (!h) {
      semHorario.push(g.id);
      continue;
    }
    await db
      .insert(t.envios)
      .values({
        ofertaId,
        grupoId: g.id,
        chaveIdempotente: chave,
        status: "agendado",
        agendadoPara: h.em,
        extra: h.extra,
      })
      .onConflictDoNothing();
    agendados.push({ grupoId: g.id, em: h.em.toISOString(), extra: h.extra });
  }
  if (agendados.length)
    await db.update(t.ofertas).set({ status: "agendada" }).where(eq(t.ofertas.id, ofertaId));
  if (agendados.length || semHorario.length)
    await registrarEvento(db, {
      tipo: "disparo.agendado",
      agente: "Disparador",
      ofertaId,
      dados: { agendados, semHorario },
    });
  return { ofertaId, agendados, semHorario, grupos: grupos.length };
}

/** POST /disparo: agenda todas as aprovadas que ainda não têm envio. */
export async function agendarAprovadas(db: Db, agora = new Date()) {
  const aprovadas = await db
    .select({ id: t.ofertas.id })
    .from(t.ofertas)
    .where(eq(t.ofertas.status, "aprovada"))
    .orderBy(desc(t.ofertas.pontuacao));
  const resultados = [];
  for (const o of aprovadas) resultados.push(await agendarOferta(db, o.id, agora));
  return resultados;
}

// ---------- envio (T5.4, T5.5) ----------

async function falhaDeEnvio(d: DepsCiclo, r: RegrasEnvio, motivo: string) {
  const atual = (await lerControle<{ n?: number }>(d.db, "falhas_envio"))?.n ?? 0;
  const n = atual + 1;
  await gravarControle(d.db, "falhas_envio", { n });
  if (n >= r.falhasSeguidasParaPausar) {
    await definirPausa(
      d.db,
      true,
      `${n} falhas de envio seguidas (última: ${motivo})`,
      "trava automática",
      d.alertas,
    );
  }
}

/** Revalida o preço logo antes de enviar. Devolve o motivo do cancelamento, ou null para seguir. */
async function revalidar(d: DepsCiclo, o: typeof t.ofertas.$inferSelect, p: typeof t.produtos.$inferSelect) {
  if (o.ensaio || !d.marketplace || p.marketplace !== d.marketplace.nome) return null;
  const detalhe = d.marketplace.detalhe.bind(d.marketplace) as (
    id: string,
    c?: { lojaId?: string | null },
  ) => ReturnType<MarketplaceAdapter["detalhe"]>;
  const atual = await detalhe(p.idExterno, { lojaId: p.lojaId });
  if (!atual || atual.emEstoque === false) {
    await d.db.update(t.produtos).set({ emEstoque: false }).where(eq(t.produtos.id, p.id));
    return "o produto acabou ou saiu do ar";
  }
  await d.db
    .update(t.produtos)
    .set({ precoAtual: atual.preco.toFixed(2), ultimaColetaEm: new Date() })
    .where(eq(t.produtos.id, p.id));
  if (atual.preco > Number(o.preco) + 0.009)
    return `o preço subiu de R$ ${Number(o.preco).toFixed(2)} para R$ ${atual.preco.toFixed(2)}`;
  return null;
}

/** Job de 1 minuto: manda o que já está na hora, se o sistema não estiver pausado. */
export async function executarDevidos(d: DepsCiclo) {
  const agora = d.agora?.() ?? new Date();
  const pausa = await lerPausa(d.db);
  if (pausa.pausado) return { pausado: true, enviados: 0, cancelados: 0, falhas: 0 };
  const r = await lerRegrasEnvio(d.db);
  const devidos = await d.db
    .select({ envio: t.envios, oferta: t.ofertas, produto: t.produtos, grupo: t.grupos })
    .from(t.envios)
    .innerJoin(t.ofertas, eq(t.ofertas.id, t.envios.ofertaId))
    .innerJoin(t.produtos, eq(t.produtos.id, t.ofertas.produtoId))
    .innerJoin(t.grupos, eq(t.grupos.id, t.envios.grupoId))
    .where(and(eq(t.envios.status, "agendado"), lte(t.envios.agendadoPara, agora)))
    .orderBy(asc(t.envios.agendadoPara))
    .limit(10);
  let enviados = 0;
  let cancelados = 0;
  let falhas = 0;
  for (const { envio, oferta, produto, grupo } of devidos) {
    // A pausa pode ter entrado no meio do lote.
    if ((await lerPausa(d.db)).pausado) break;
    const cancelar = async (motivo: string, avisar: boolean) => {
      await d.db.update(t.envios).set({ status: "cancelado", erro: motivo }).where(eq(t.envios.id, envio.id));
      await d.db
        .update(t.ofertas)
        .set({ status: "cancelada", motivoReprovacao: motivo })
        .where(eq(t.ofertas.id, oferta.id));
      await registrarEvento(d.db, {
        tipo: "disparo.cancelado",
        agente: "Disparador",
        ofertaId: oferta.id,
        dados: { envioId: envio.id, motivo },
      });
      if (avisar)
        await d.alertas.enviar(`🚫 Envio cancelado: ${produto.nome.slice(0, 60)}. Motivo: ${motivo}.`);
      cancelados++;
    };
    if (oferta.ensaio && !grupo.teste) {
      await cancelar("oferta de ensaio só vai para grupo de teste", false);
      continue;
    }
    let motivo: string | null;
    try {
      motivo = await revalidar(d, oferta, produto);
    } catch (e) {
      // marketplace fora: tenta de novo em 5 min
      await d.db
        .update(t.envios)
        .set({
          agendadoPara: new Date(agora.getTime() + 5 * 60_000),
          erro: `revalidação: ${(e as Error).message.slice(0, 200)}`,
        })
        .where(eq(t.envios.id, envio.id));
      continue;
    }
    if (motivo) {
      await cancelar(motivo, true);
      continue;
    }
    const [copy] = await d.db
      .select()
      .from(t.copies)
      .where(and(eq(t.copies.ofertaId, oferta.id), eq(t.copies.escolhida, true), eq(t.copies.validada, true)))
      .orderBy(desc(t.copies.id))
      .limit(1);
    const pecas = await d.db
      .select()
      .from(t.imagens)
      .where(eq(t.imagens.ofertaId, oferta.id))
      .orderBy(desc(t.imagens.id));
    const peca = pecas.find((p) => p.formato === r.formato) ?? pecas[0];
    if (!copy || !peca?.url) {
      await cancelar(!copy ? "sem copy válida" : "sem peça", true);
      continue;
    }
    if (!grupo.waJid || !d.gateway) {
      await d.db
        .update(t.envios)
        .set({
          status: "falhou",
          erro: !grupo.waJid ? "grupo sem JID do WhatsApp" : "wa-gateway não configurado",
        })
        .where(eq(t.envios.id, envio.id));
      falhas++;
      await falhaDeEnvio(d, r, !grupo.waJid ? "grupo sem JID" : "gateway não configurado");
      continue;
    }
    const link = await obterLink(d.db, d.marketplace, oferta.id, grupo.id, envio.agendadoPara ?? agora);
    const texto = copy.texto.replaceAll("{{link}}", `${d.painelUrl.replace(/\/$/, "")}/r/${link.codigo}`);
    await d.db
      .update(t.envios)
      .set({ status: "enviando", linkId: link.id, texto, imagemUrl: peca.url })
      .where(eq(t.envios.id, envio.id));
    try {
      const job = await d.gateway.enviarGrupo(grupo.waJid, texto, peca.url, `envio:${envio.id}`);
      await d.db.update(t.envios).set({ jobGateway: job.id, erro: null }).where(eq(t.envios.id, envio.id));
      await registrarEvento(d.db, {
        tipo: "disparo.enfileirado",
        agente: "Disparador",
        ofertaId: oferta.id,
        dados: { envioId: envio.id, grupo: grupo.nome, job: job.id },
      });
      enviados++;
    } catch (e) {
      const msg = (e as Error).message.slice(0, 300);
      await d.db.update(t.envios).set({ status: "falhou", erro: msg }).where(eq(t.envios.id, envio.id));
      await registrarEvento(d.db, {
        tipo: "disparo.falhou",
        agente: "Disparador",
        ofertaId: oferta.id,
        dados: { envioId: envio.id, erro: msg },
      });
      falhas++;
      await falhaDeEnvio(d, r, msg);
    }
  }
  return { pausado: false, enviados, cancelados, falhas };
}

// ---------- webhook do wa-gateway (T5.6) ----------

export interface EventoGateway {
  type: string;
  [k: string]: unknown;
}

export async function aoEventoGateway(d: DepsCiclo, e: EventoGateway) {
  const r = await lerRegrasEnvio(d.db);
  const tipo = e.type.replace(/^pool\./, "");
  switch (tipo) {
    case "envio": {
      const id = /^envio:(\d+)$/.exec(String(e.ref ?? ""))?.[1];
      if (!id) return { tratado: false };
      const [envio] = await d.db
        .select()
        .from(t.envios)
        .where(eq(t.envios.id, Number(id)));
      if (!envio) return { tratado: false };
      if (e.status === "enviado") {
        await d.db
          .update(t.envios)
          .set({
            status: "enviado",
            enviadoEm: new Date(String(e.at ?? new Date().toISOString())),
            numeroGateway: String(e.instanceId ?? ""),
          })
          .where(eq(t.envios.id, envio.id));
        await d.db.update(t.ofertas).set({ status: "enviada" }).where(eq(t.ofertas.id, envio.ofertaId));
        await gravarControle(d.db, "falhas_envio", { n: 0 });
        await registrarEvento(d.db, {
          tipo: "envio.enviado",
          agente: "Disparador",
          ofertaId: envio.ofertaId,
          dados: { envioId: envio.id, numero: e.instanceId },
        });
      } else {
        const erro = String(e.erro ?? "falha no gateway").slice(0, 300);
        await d.db.update(t.envios).set({ status: "falhou", erro }).where(eq(t.envios.id, envio.id));
        await registrarEvento(d.db, {
          tipo: "envio.falhou",
          agente: "Disparador",
          ofertaId: envio.ofertaId,
          dados: { envioId: envio.id, erro },
        });
        await falhaDeEnvio(d, r, erro);
      }
      return { tratado: true };
    }
    case "comando": {
      const c = String(e.comando ?? "");
      if (c === "PAUSAR")
        await definirPausa(d.db, true, "comando PAUSAR no WhatsApp", "Aurimar (WhatsApp)", d.alertas);
      else if (c === "RETOMAR")
        await definirPausa(d.db, false, "comando RETOMAR no WhatsApp", "Aurimar (WhatsApp)", d.alertas);
      else if (c === "STATUS") await d.alertas.enviar(await textoStatus(d.db));
      return { tratado: true };
    }
    case "numero_banido": {
      await registrarEvento(d.db, {
        tipo: "numero_banido",
        agente: "wa-gateway",
        dados: { numero: e.numero, motivo: e.motivo },
      });
      await d.alertas.enviar(`⚠️ Número ${String(e.numero)} caiu: ${String(e.motivo)}.`);
      if (r.pausarEmBanimento && String(e.motivo).includes("recusada"))
        await definirPausa(d.db, true, `número ${String(e.numero)} banido`, "trava automática", d.alertas);
      return { tratado: true };
    }
    case "failover":
      await registrarEvento(d.db, {
        tipo: "numero.failover",
        agente: "wa-gateway",
        dados: { de: e.de, para: e.para, motivo: e.motivo },
      });
      if (e.de)
        await d.alertas.enviar(
          `🔁 Troca de número: ${String(e.de)} → ${String(e.para)} (${String(e.motivo)}).`,
        );
      return { tratado: true };
    case "sem_numero":
      await definirPausa(d.db, true, "nenhum número de reserva disponível", "trava automática", d.alertas);
      return { tratado: true };
    case "numero_pessoal_bloqueado":
      await registrarEvento(d.db, {
        tipo: "numero.bloqueado",
        agente: "wa-gateway",
        dados: { numero: e.numero },
      });
      await d.alertas.enviar(
        "🔒 Um número pessoal foi pareado no gateway e foi desconectado. Use só os chips dedicados.",
      );
      return { tratado: true };
    case "entrada":
      await registrarEvento(d.db, {
        tipo: "grupo.entrada",
        agente: "wa-gateway",
        dados: { chave: e.chave, origem: e.origem },
      });
      return { tratado: true };
    default:
      await registrarEvento(d.db, {
        tipo: `gateway.${tipo}`.slice(0, 80),
        agente: "wa-gateway",
        dados: { ...e, type: undefined },
      });
      return { tratado: false };
  }
}

export async function textoStatus(db: Db): Promise<string> {
  const p = await lerPausa(db);
  const hoje = horarioBrt(diaBrt(new Date()), "00:00");
  const [env] = await db
    .select({
      enviados: sql<number>`count(*) filter (where ${t.envios.status} = 'enviado')::int`,
      agendados: sql<number>`count(*) filter (where ${t.envios.status} = 'agendado')::int`,
    })
    .from(t.envios)
    .where(gte(t.envios.criadoEm, hoje));
  return [
    p.pausado ? `⏸️ PAUSADO: ${p.motivo}` : "▶️ Rodando",
    `Hoje: ${env?.enviados ?? 0} enviadas, ${env?.agendados ?? 0} agendadas.`,
  ].join("\n");
}

// ---------- travas (T5.7) ----------

export async function verificarAnomalias(d: DepsCiclo) {
  const r = await lerRegrasEnvio(d.db);
  const rep = await reprovacaoHoje(d.db);
  if (rep.total >= r.reprovacaoMinAmostras && (rep.reprovadas / rep.total) * 100 > r.reprovacaoMaxPct) {
    const pct = Math.round((rep.reprovadas / rep.total) * 100);
    if (!(await lerPausa(d.db)).pausado)
      await definirPausa(
        d.db,
        true,
        `${pct}% das ofertas reprovadas hoje (${rep.reprovadas} de ${rep.total})`,
        "trava automática",
        d.alertas,
      );
  }
  return rep;
}

// ---------- ciclo de uma oferta ----------

/** Arte, copy e checagem; aprovada segue direto para o agendamento. */
export async function prepararOferta(d: DepsCiclo, ofertaId: number, agente = "worker") {
  const r = await lerRegrasEnvio(d.db);
  let arte: unknown = null;
  try {
    arte = await renderizar(
      d.db,
      { ofertaId, formatos: ["quadrado", "retrato"], agente: "Diretor de Arte" },
      d.arte,
    );
  } catch (e) {
    arte = { erro: (e as Error).message };
  }
  const copy = await gerarCopy(d.db, ofertaId, {
    openrouterKey: d.openrouterKey,
    openrouterBaseUrl: d.openrouterBaseUrl,
    alertas: d.alertas,
    ...(d.fLlm ? { f: d.fLlm } : {}),
  });
  const checagem = await checarOferta(d.db, ofertaId);
  await verificarAnomalias(d);
  const disparo = checagem.aprovada ? await agendarOferta(d.db, ofertaId, d.agora?.() ?? new Date()) : null;
  await registrarEvento(d.db, {
    tipo: "oferta.preparada",
    agente,
    ofertaId,
    dados: { aprovada: checagem.aprovada, formato: r.formato, agendados: disparo?.agendados.length ?? 0 },
  });
  return { ofertaId, arte, copy: { escolhida: copy.escolhida, semLlm: copy.semLlm }, checagem, disparo };
}

/** Candidatas ainda sem checagem, as de maior pontuação primeiro. */
export async function candidatasPendentes(db: Db, limite: number) {
  return db
    .select({ id: t.ofertas.id })
    .from(t.ofertas)
    .where(
      and(
        eq(t.ofertas.status, "candidata"),
        notExists(db.select({ x: sql`1` }).from(t.checagens).where(eq(t.checagens.ofertaId, t.ofertas.id))),
      ),
    )
    .orderBy(sql`${t.ofertas.pontuacao} desc nulls last`)
    .limit(limite);
}
