import { Pool } from "pg";
import type { Secret } from "../config.js";
import type { SqlClient, SqlRunner } from "./client.js";

export interface PgClientOptions {
  /** Teto de uma consulta no servidor e no cliente (toda chamada externa tem timeout total). */
  queryTimeoutMs?: number;
  connectTimeoutMs?: number;
  maxConnections?: number;
}

/**
 * Cliente do worker (role service_role/dedicada). A URL vem de env via `Secret`; nunca é logada.
 * O pooler do Supabase em modo transação é suportado: nada aqui usa lock/estado de sessão.
 */
export function createPgClient(databaseUrl: Secret, opts: PgClientOptions = {}): SqlClient & { close(): Promise<void> } {
  const queryTimeoutMs = opts.queryTimeoutMs ?? 15_000;
  const pool = new Pool({
    connectionString: databaseUrl.reveal(),
    max: opts.maxConnections ?? 4,
    connectionTimeoutMillis: opts.connectTimeoutMs ?? 10_000,
    statement_timeout: queryTimeoutMs,
    query_timeout: queryTimeoutMs + 1_000,
    idle_in_transaction_session_timeout: queryTimeoutMs * 2,
    options: "-c timezone=UTC",
  });
  // erro de conexão ociosa não pode derrubar o processo nem vazar a URL
  pool.on("error", () => undefined);

  return {
    async query(text, params) {
      const r = await pool.query(text, params as unknown[] | undefined);
      return { rows: r.rows };
    },
    async transaction<T>(fn: (tx: SqlRunner) => Promise<T>): Promise<T> {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        const out = await fn({
          query: async (text, params) => ({ rows: (await c.query(text, params as unknown[] | undefined)).rows }),
        });
        await c.query("COMMIT");
        return out;
      } catch (e) {
        await c.query("ROLLBACK").catch(() => undefined);
        throw e;
      } finally {
        c.release();
      }
    },
    close: () => pool.end(),
  };
}
