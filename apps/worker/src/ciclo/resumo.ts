import { type Db, tabelas as t } from "@achadinhos/db";
import { and, eq, gte, sql } from "drizzle-orm";
import { resumoDoDia } from "../painel/rotas.js";
import { registrarEvento } from "../servicos.js";
import { type Alertas, gravarControle, lerControle, lerPausa } from "./controle.js";
import { diaBrt, horarioBrt } from "./disparo.js";

/** Documentos cujas mudanças mexem em gasto ou grupos: entram em destaque no resumo (T7.6). */
const DOCS_SENSIVEIS = new Set(["REGRAS-DE-ENVIO", "NICHOS", "AGENTES", "METRICAS", "FAILOVER"]);
const PALAVRAS_SENSIVEIS = /gasto|custo|teto|grupo|horário|horario|limite|modelo/i;

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export async function montarResumo(db: Db, observacoes?: string) {
  const r = await resumoDoDia(db);
  const pausa = await lerPausa(db);
  const hoje = horarioBrt(diaBrt(new Date()), "00:00");
  const propostas = await db
    .select({
      titulo: t.propostas.titulo,
      docSlug: t.propostas.docSlug,
      status: t.propostas.status,
      decididoPor: t.propostas.decididoPor,
    })
    .from(t.propostas)
    .where(gte(t.propostas.decididoEm, hoje));
  const sensiveis = propostas.filter(
    (p) =>
      p.status === "aprovada" &&
      ((p.docSlug && DOCS_SENSIVEIS.has(p.docSlug)) || PALAVRAS_SENSIVEIS.test(p.titulo)),
  );
  const [cancel] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(t.envios)
    .where(and(eq(t.envios.status, "cancelado"), gte(t.envios.criadoEm, hoje)));
  const linhas = [
    `📊 *Achadinhos · resumo de ${new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}*`,
    pausa.pausado ? `⏸️ Pausado: ${pausa.motivo}` : "▶️ Operação rodando",
    "",
    `Ofertas: ${r.ofertas.enviadas} enviadas, ${r.ofertas.agendadas} agendadas, ${r.ofertas.reprovadas} reprovadas de ${r.ofertas.avaliadas} checadas${cancel?.n ? `, ${cancel.n} canceladas` : ""}.`,
    `Cliques: ${r.cliques.hoje} (ontem ${r.cliques.ontem}).`,
    `Conversões: ${r.conversoes.hoje} · comissão ${brl(r.comissao.hoje)}.`,
    `IA: US$ ${r.llm.dia.toFixed(2)} hoje (teto US$ ${r.llm.tetoDiario.toFixed(2)}), US$ ${r.llm.mes.toFixed(2)} no mês.`,
  ];
  if (propostas.length) {
    linhas.push("", `Propostas decididas hoje: ${propostas.length}.`);
    for (const p of sensiveis)
      linhas.push(`⚠️ Mudou gasto/grupos: ${p.titulo} (aprovada por ${p.decididoPor ?? "?"})`);
  }
  if (observacoes?.trim()) linhas.push("", `Coordenador: ${observacoes.trim().slice(0, 500)}`);
  return linhas.join("\n");
}

/** Manda o resumo no WhatsApp do dono e marca o dia (o reserva das 21h05 não manda de novo). */
export async function enviarResumo(db: Db, alertas: Alertas, por: string, observacoes?: string) {
  const texto = await montarResumo(db, observacoes);
  const r = await alertas.enviar(texto, `resumo:${diaBrt(new Date())}`);
  await gravarControle(db, "resumo", { dia: diaBrt(new Date()), por, enviado: r.enviado });
  await registrarEvento(db, {
    tipo: "resumo.enviado",
    agente: por,
    dados: { enviado: r.enviado, motivo: r.motivo },
  });
  return { texto, ...r };
}

/** Reserva: se ninguém mandou o resumo até 21h05, o worker manda. */
export async function resumoReserva(db: Db, alertas: Alertas) {
  const ja = await lerControle<{ dia?: string }>(db, "resumo");
  if (ja?.dia === diaBrt(new Date())) return { enviado: false, motivo: "já enviado hoje" };
  return enviarResumo(db, alertas, "worker (reserva)");
}
