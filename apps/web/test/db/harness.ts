import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

/**
 * Banco de teste sem Docker: PGlite (Postgres real em WASM) com um mínimo de Supabase simulado
 * (auth.users/auth.uid(), vault.*, papéis) e as migrações reais de `supabase/migrations`.
 * O Vault aqui é só uma tabela: o que se testa é o contrato (RPC write-only, RLS), não a criptografia.
 */
const MIGRATIONS = join(__dirname, "../../../../supabase/migrations");

const SUPABASE_STUB = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key, aud text, role text, email text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create schema vault;
create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, description text,
  secret text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create function vault.create_secret(new_secret text, new_name text default null, new_description text default '')
returns uuid language sql as $$
  insert into vault.secrets (secret, name, description) values (new_secret, new_name, new_description) returning id $$;
create function vault.update_secret(secret_id uuid, new_secret text default null, new_name text default null, new_description text default null)
returns void language sql as $$
  update vault.secrets set secret = coalesce(new_secret, secret), name = coalesce(new_name, name),
    updated_at = now() where id = secret_id $$;
grant usage on schema auth to authenticated, anon, service_role;
`;

export interface TestDb {
  db: PGlite;
  /** Executa como `authenticated` com o `sub` do JWT (é o que o PostgREST faz). */
  asUser<T>(userId: string, fn: () => Promise<T>): Promise<T>;
  addUser(id: string): Promise<void>;
}

export async function createDb(): Promise<TestDb> {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
  }
  let chain: Promise<unknown> = Promise.resolve();
  return {
    db,
    addUser: async (id) => {
      await db.query("insert into auth.users (id, aud, role, email) values ($1,'authenticated','authenticated',$2)", [id, `${id}@t.test`]);
    },
    asUser(userId, fn) {
      // PGlite é uma conexão só: serializa para o SET ROLE de uma chamada não vazar na outra.
      const run = chain.then(async () => {
        await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false)`);
        try { return await fn(); } finally { await db.exec("reset role; select set_config('request.jwt.claim.sub','',false)"); }
      });
      chain = run.catch(() => undefined);
      return run as Promise<never>;
    },
  };
}

export type RpcResult = { data: unknown; error: { message: string; code?: string } | null };
export type RpcFn = (fn: string, args?: Record<string, unknown>) => Promise<RpcResult>;

/**
 * Faz o papel do PostgREST: `rpc(nome, args)` vira `select public.nome(p => $n)` como `authenticated`
 * com o `sub` do usuário. Objetos viram jsonb; erro do Postgres vira `{ message, code }`.
 */
export function rpcAs(t: TestDb, userId: string): RpcFn {
  return (fn, args = {}) =>
    t.asUser(userId, async () => {
      const keys = Object.keys(args);
      const params = keys.map((k) => {
        const v = args[k];
        return v !== null && typeof v === "object" ? JSON.stringify(v) : v;
      });
      const sql = `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as data`;
      try {
        const r = await t.db.query<{ data: unknown }>(sql, params);
        return { data: r.rows[0]?.data ?? null, error: null };
      } catch (e) {
        const err = e as { message?: string; code?: string };
        return { data: null, error: { message: String(err.message), code: err.code } };
      }
    });
}
