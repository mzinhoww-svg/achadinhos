import type { PgBoss } from "pg-boss";
import { cuidarDaFila, type DepsReels } from "./servico.js";

export const FILA_REELS = "reels-fila";

/** A cada 15 min: Reel das fotos para quem ficou sem vídeo perto do horário, e limpeza de arquivos antigos. */
export async function agendarReels(
  boss: PgBoss,
  d: DepsReels,
  log: { warn: (o: unknown, m: string) => void },
) {
  await boss.createQueue(FILA_REELS, { policy: "singleton" }).catch(() => {});
  await boss.work(FILA_REELS, async () => {
    try {
      await cuidarDaFila(d);
    } catch (e) {
      log.warn({ err: e }, "fila de reels falhou");
    }
  });
  await boss.schedule(FILA_REELS, "*/15 * * * *", {}, { tz: "America/Sao_Paulo" });
}
