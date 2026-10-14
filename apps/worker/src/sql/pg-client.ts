import { Pool } from "pg";
import type { Secret } from "../config.js";
import type { SqlClient, SqlRunner } from "./client.js";

/** Erro fixo: nunca carrega a URL, o host nem o usuário. */
export class InsecureConnectionError extends Error {
  constructor(reason: string) {
    super(`conexão com o banco recusada: ${reason}`);
    this.name = "InsecureConnectionError";
  }
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const VERIFYING_MODES = new Set(["require", "verify-ca", "verify-full"]);

export interface TlsResolution {
  connectionString: string;
  ssl: false | { rejectUnauthorized: true; ca?: string };
}

/**
 * TLS é obrigatório fora de loopback: por esta conexão passam segredos do Vault em texto.
 * A URL precisa pedir `sslmode=require|verify-ca|verify-full`; o certificado é SEMPRE verificado
 * (o `sslmode` sai da string para o `pg` não rebaixar a verificação). `caCert` = CA do Supabase.
 */
export function resolveTls(databaseUrl: string, opts: { caCert?: string } = {}): TlsResolution {
  let u: URL;
  try {
    u = new URL(databaseUrl);
  } catch {
    throw new InsecureConnectionError("URL inválida");
  }
  const mode = u.searchParams.get("sslmode");
  u.searchParams.delete("sslmode");
  if (LOOPBACK.has(u.hostname)) {
    return { connectionString: u.toString(), ssl: false };
  }
  if (!mode || !VERIFYING_MODES.has(mode)) {
    throw new InsecureConnectionError("TLS obrigatório fora de localhost (use sslmode=require ou verify-full)");
  }
  return {
    connectionString: u.toString(),
    ssl: opts.caCert ? { rejectUnauthorized: true, ca: opts.caCert } : { rejectUnauthorized: true },
  };
}

/**
 * Falha na partida se a conexão for dono/superuser (postgres, supabase_admin): o worker deve
 * entrar como a role de login dedicada (migração `achadinhos_worker`). Devolve o `session_user`.
 */
export async function assertWorkerRole(db: SqlRunner): Promise<string> {
  const r = await db.query<{ session_user: string; current_user: string; is_super: boolean; owns_sends: boolean }>(
    `select session_user::text as session_user, current_user::text as current_user,
            exists (select 1 from pg_roles r where r.rolname in (session_user, current_user) and r.rolsuper) as is_super,
            exists (select 1 from pg_class c join pg_roles r on r.oid = c.relowner
                     where c.oid = 'public.sends'::regclass and r.rolname in (session_user, current_user)) as owns_sends`,
  );
  const x = r.rows[0];
  const privileged = ["postgres", "supabase_admin"];
  if (
    !x ||
    x.is_super ||
    x.owns_sends ||
    privileged.includes(x.session_user) ||
    privileged.includes(x.current_user)
  ) {
    throw new Error("role do banco inadequada: o worker não pode conectar como dono/superuser (use achadinhos_worker)");
  }
  return x.session_user;
}

export interface PgClientOptions {
  /** Teto de uma consulta no servidor e no cliente (toda chamada externa tem timeout total). */
  queryTimeoutMs?: number;
  connectTimeoutMs?: number;
  maxConnections?: number;
  /** CA (PEM) para validar o certificado do banco; sem ela vale a cadeia do sistema. */
  caCert?: string;
}

/**
 * Cliente do worker (role service_role/dedicada). A URL vem de env via `Secret`; nunca é logada.
 * O pooler do Supabase em modo transação é suportado: nada aqui usa lock/estado de sessão.
 */
export function createPgClient(databaseUrl: Secret, opts: PgClientOptions = {}): SqlClient & { close(): Promise<void> } {
  const queryTimeoutMs = opts.queryTimeoutMs ?? 15_000;
  const tls = resolveTls(databaseUrl.reveal(), opts.caCert ? { caCert: opts.caCert } : {});
  const pool = new Pool({
    connectionString: tls.connectionString,
    ssl: tls.ssl,
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
