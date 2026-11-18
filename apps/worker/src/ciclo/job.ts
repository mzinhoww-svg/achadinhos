import type { PgBoss } from "pg-boss";
import { registrarEvento } from "../servicos.js";
import { gravarControle, lerControle } from "./controle.js";
import { importarConversoes } from "./conversoes.js";
import {
  agendarAprovadas,
  candidatasPendentes,
  type DepsCiclo,
  executarDevidos,
  prepararOferta,
} from "./disparo.js";
import { resumoReserva } from "./resumo.js";

export const FILA_DISPARO = "disparo-tick";
export const FILA_CICLO = "ciclo-reserva";
export const FILA_RESUMO = "resumo-reserva";
export const FILA_CONVERSOES = "conversoes-diarias";

/** Último sinal dos agentes do OpenBot (requisições com x-origem: openbot). */
export async function registrarSinalOpenbot(d: Pick<DepsCiclo, "db">) {
  await gravarControle(d.db, "openbot", { ultimoSinal: new Date().toISOString() });
}

export async function openbotCalado(d: Pick<DepsCiclo, "db">, minutos = 30): Promise<boolean> {
  const v = await lerControle<{ ultimoSinal?: string }>(d.db, "openbot");
  return !v?.ultimoSinal || Date.now() - Date.parse(v.ultimoSinal) > minutos * 60_000;
}

/**
 * T7.5 (já preparado aqui): quando os agentes ficam calados por mais de 30 min, o worker prepara as
 * candidatas (arte, copy, checagem) e agenda as aprovadas com as regras atuais, e avisa o dono uma vez por dia.
 */
export async function rodarCicloReserva(d: DepsCiclo, modo: "reserva" | "sempre" | "nunca", limite = 5) {
  if (modo === "nunca") return { rodou: false, motivo: "CICLO_AUTOMATICO=nunca" };
  if (modo === "reserva" && !(await openbotCalado(d))) return { rodou: false, motivo: "agentes ativos" };
  if (modo === "reserva")
    await d.alertas.umaVezPorDia(
      "ciclo-reserva",
      "🤖 Os agentes estão calados há mais de 30 min: o worker assumiu o ciclo reserva.",
    );
  const preparadas = [];
  for (const o of await candidatasPendentes(d.db, limite)) {
    try {
      const r = await prepararOferta(d, o.id, "ciclo-reserva");
      preparadas.push({ ofertaId: o.id, aprovada: r.checagem.aprovada });
    } catch (e) {
      preparadas.push({ ofertaId: o.id, erro: (e as Error).message.slice(0, 200) });
    }
  }
  const agendadas = await agendarAprovadas(d.db);
  if (preparadas.length)
    await registrarEvento(d.db, {
      tipo: "ciclo.reserva",
      agente: "worker",
      dados: { preparadas, agendadas: agendadas.length },
    });
  return { rodou: true, preparadas, agendadas: agendadas.length };
}

export async function agendarCiclo(
  boss: PgBoss,
  d: DepsCiclo,
  o: {
    cronDisparo: string;
    modo: "reserva" | "sempre" | "nunca";
    log: { info: (m: string) => void; warn: (o: unknown, m: string) => void };
  },
) {
  for (const fila of [FILA_DISPARO, FILA_CICLO, FILA_RESUMO, FILA_CONVERSOES])
    await boss.createQueue(fila, { policy: "singleton" }).catch(() => {});
  await boss.work(FILA_DISPARO, async () => {
    try {
      await executarDevidos(d);
    } catch (e) {
      o.log.warn({ err: e }, "disparo falhou");
      await d.alertas.umaVezPorDia(
        "job-disparo",
        `⚠️ O job de disparo falhou: ${(e as Error).message.slice(0, 160)}`,
      );
    }
  });
  await boss.work(FILA_CICLO, async () => {
    try {
      await rodarCicloReserva(d, o.modo);
    } catch (e) {
      o.log.warn({ err: e }, "ciclo reserva falhou");
      await d.alertas.umaVezPorDia(
        "job-ciclo",
        `⚠️ O ciclo reserva falhou: ${(e as Error).message.slice(0, 160)}`,
      );
    }
  });
  await boss.work(FILA_RESUMO, async () => {
    try {
      await resumoReserva(d.db, d.alertas);
    } catch (e) {
      o.log.warn({ err: e }, "resumo reserva falhou");
    }
  });
  await boss.work(FILA_CONVERSOES, async () => {
    try {
      await importarConversoes(d.db, d.marketplace, 7);
    } catch (e) {
      o.log.warn({ err: e }, "importação de conversões falhou");
      await d.alertas.umaVezPorDia(
        "conversoes",
        `⚠️ A importação das conversões da Shopee falhou: ${(e as Error).message.slice(0, 160)}`,
      );
    }
  });
  await boss.schedule(FILA_CONVERSOES, "40 5 * * *", {}, { tz: "America/Sao_Paulo" });
  await boss.schedule(FILA_RESUMO, "5 21 * * *", {}, { tz: "America/Sao_Paulo" });
  await boss.schedule(FILA_DISPARO, o.cronDisparo, {}, { tz: "America/Sao_Paulo" });
  await boss.schedule(FILA_CICLO, "*/15 * * * *", {}, { tz: "America/Sao_Paulo" });
  o.log.info("disparo (1 min) e ciclo reserva (15 min) agendados");
}
