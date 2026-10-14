import type { PGlite } from "@electric-sql/pglite";
import type { SqlClient } from "../../src/sql/client.js";

/** Mesma interface do cliente `pg`, sobre o Postgres embutido. */
export function pgliteClient(db: PGlite): SqlClient {
  return {
    query: async (text, params) => ({ rows: (await db.query(text, params as unknown[] | undefined)).rows as never[] }),
    transaction: (fn) =>
      db.transaction((tx) => fn({ query: async (text, params) => ({ rows: (await tx.query(text, params as unknown[] | undefined)).rows as never[] }) })),
  };
}

/** Roda `fn` como dono do banco (postgres) e volta para a role do worker. */
export async function asOwner<T>(db: PGlite, fn: () => Promise<T>, backTo = "service_role"): Promise<T> {
  await db.exec("reset role");
  try {
    return await fn();
  } finally {
    await db.exec(`set role ${backTo}`);
  }
}
