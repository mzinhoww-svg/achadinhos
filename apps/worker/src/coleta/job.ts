import type { Db } from "@achadinhos/db";
import type { PgBoss } from "pg-boss";
import type { Marketplaces } from "./marketplaces.js";
import type { RegrasOferta } from "./regras.js";
import { rodarMonitor } from "./servico.js";

export const FILA_MONITOR = "monitor-precos";

/**
 * T2.3: o Monitor roda sozinho pela agenda (cron, fuso de São Paulo; padrão a cada 2 h).
 * A fila é `singleton`: se uma rodada demorar, a próxima não começa por cima dela.
 */
export async function agendarMonitor(
  boss: PgBoss,
  db: Db,
  mk: Marketplaces,
  o: {
    cron: string;
    maxDetalhes: number;
    regras: RegrasOferta;
    log: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void };
  },
) {
  await boss.createQueue(FILA_MONITOR, { policy: "singleton", expireInSeconds: 3600, retryLimit: 1 });
  await boss.schedule(FILA_MONITOR, o.cron, {}, { tz: "America/Sao_Paulo" });
  await boss.work(FILA_MONITOR, async () => {
    if (!mk.principal) {
      o.log.warn({ motivo: mk.indisponivel }, "Monitor pulado: marketplace indisponível");
      return;
    }
    const r = await rodarMonitor(db, mk.principal, { maxDetalhes: o.maxDetalhes, regras: o.regras });
    o.log.info({ ...r }, "Monitor concluído");
  });
}
