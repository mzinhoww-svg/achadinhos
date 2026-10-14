import type { SqlRunner } from "./client.js";

/**
 * Relógio do banco para o código síncrono do agendador: guarda o desvio entre `now()` do
 * Postgres e o relógio local e o reaplica. `sync()` roda no início de cada tick (decisão 001:
 * o relógio do processo não decide regra de negócio).
 */
export function createDbClock(db: SqlRunner, local: () => number = Date.now) {
  let offset = 0;
  return {
    now: (): Date => new Date(local() + offset),
    async sync(): Promise<void> {
      const before = local();
      const r = await db.query<{ t: Date }>("select now() as t");
      const t = r.rows[0]?.t;
      if (t instanceof Date) offset = t.getTime() - Math.round((before + local()) / 2);
    },
  };
}
