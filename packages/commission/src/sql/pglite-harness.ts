import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../../supabase/migrations");

/** Stubs mínimos do que o Supabase fornece e as migrações assumem (papéis, auth, vault). */
const SUPABASE_STUBS = `
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA auth; CREATE SCHEMA vault;
CREATE TABLE auth.users (id uuid PRIMARY KEY, aud text, role text, email text);
CREATE TABLE vault.secrets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, secret text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
`;

/** Postgres embutido (WASM, sem Docker) com o schema real das migrações aplicado. */
export async function createMigratedDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  return db;
}
