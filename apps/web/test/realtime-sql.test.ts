import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * T8-11 — a migração publica `public.sends` no Realtime e o RLS continua valendo para o assinante.
 * Roda em Postgres embutido (PGlite, sem Docker). O servidor Realtime em si não existe aqui: o que se prova é
 * (a) a publicação e (b) que o papel `authenticated` de outra conta não enxerga as linhas — é esse o filtro que
 * o Realtime aplica a cada evento (`postgres_changes` avalia o RLS com o JWT do assinante).
 */
const MIGRATIONS = join(__dirname, "../../../supabase/migrations");
const A = { user: "11111111-1111-1111-1111-111111111111", account: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };
const B = { user: "22222222-2222-2222-2222-222222222222", account: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" };

const BOOTSTRAP = `
  CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
  CREATE SCHEMA auth; CREATE SCHEMA vault;
  CREATE TABLE auth.users (id uuid PRIMARY KEY, aud text, role text, email text);
  CREATE TABLE vault.secrets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, secret text);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
    AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  GRANT USAGE ON SCHEMA auth, public TO authenticated, anon, service_role;
  GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon, service_role;
  CREATE PUBLICATION supabase_realtime;
`;

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(BOOTSTRAP);
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
  }
  await db.exec(`GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA public TO authenticated;`);
  await db.exec(`
    INSERT INTO auth.users (id, aud, role, email) VALUES ('${A.user}','authenticated','authenticated','a@t.com'),('${B.user}','authenticated','authenticated','b@t.com');
    INSERT INTO public.accounts (account_id, user_id) VALUES ('${A.account}','${A.user}'),('${B.account}','${B.user}');
    INSERT INTO public.sends (account_id, status, idempotency_key) VALUES ('${A.account}','queued','k-a'),('${B.account}','queued','k-b');
  `);
});
afterAll(async () => db.close());

async function seenBy(user: string): Promise<string[]> {
  return db.transaction(async (tx) => {
    await tx.exec(`SELECT set_config('request.jwt.claim.sub','${user}', true); SET LOCAL ROLE authenticated;`);
    const r = await tx.query<{ account_id: string }>(`SELECT account_id FROM public.sends`);
    return r.rows.map((x) => x.account_id);
  });
}

describe("T8-11 publicação Realtime de public.sends", () => {
  it("public.sends está na publicação supabase_realtime", async () => {
    const r = await db.query<{ tablename: string }>(
      `SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public'`,
    );
    expect(r.rows.map((x) => x.tablename)).toContain("sends");
  });
  it("só sends é publicada (nada de tabela sem necessidade)", async () => {
    const r = await db.query<{ tablename: string }>(`SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime'`);
    expect(r.rows.map((x) => x.tablename)).toEqual(["sends"]);
  });
  it("a tabela publicada tem RLS ativo e forçado", async () => {
    const r = await db.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'public.sends'::regclass`,
    );
    expect(r.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });
  it("a migração é idempotente (reaplicar não falha nem duplica)", async () => {
    const f = readdirSync(MIGRATIONS).filter((x) => /realtime/.test(x))[0]!;
    await db.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
    const r = await db.query(`SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='sends'`);
    expect(r.rows).toHaveLength(1);
  });
});

describe("T8-11 RLS para o assinante (outra conta não recebe)", () => {
  it("a conta A enxerga só os envios da conta A", async () => {
    expect(await seenBy(A.user)).toEqual([A.account]);
  });
  it("a conta B enxerga só os envios da conta B", async () => {
    expect(await seenBy(B.user)).toEqual([B.account]);
  });
  it("anônimo não enxerga nenhum envio", async () => {
    const rows = await db.transaction(async (tx) => {
      await tx.exec(`SET LOCAL ROLE anon;`);
      try {
        return (await tx.query(`SELECT * FROM public.sends`)).rows;
      } catch {
        return [];
      }
    });
    expect(rows).toEqual([]);
  });
});
