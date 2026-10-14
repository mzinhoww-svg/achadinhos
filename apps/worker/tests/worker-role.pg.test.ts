import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createDb } from "./sql/pglite-db.js";
import { pgliteClient } from "./sql/pglite-client.js";
import { seedAccount } from "./sql/fixtures.js";
import { assertWorkerRole } from "../src/sql/pg-client.js";
import { PgQueue } from "../src/sql/queue.js";

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
}, 60_000);
afterAll(async () => db?.close());

describe("role de login do worker (QA #37, bloqueante 2)", () => {
  it("existe, pode logar, não é superuser nem dono, e herda service_role", async () => {
    const r = await db.query<{ rolcanlogin: boolean; rolsuper: boolean; member: boolean }>(
      `select rolcanlogin, rolsuper, pg_has_role('achadinhos_worker','service_role','member') as member
         from pg_roles where rolname = 'achadinhos_worker'`,
    );
    expect(r.rows[0]).toEqual({ rolcanlogin: true, rolsuper: false, member: true });
  });

  it("tem statement_timeout próprio", async () => {
    const r = await db.query<{ cfg: string[] }>("select rolconfig as cfg from pg_roles where rolname = 'achadinhos_worker'");
    expect(r.rows[0]!.cfg.join(",")).toMatch(/statement_timeout=/);
  });

  // O Postgres aplica `ALTER ROLE ... SET role` ao conectar; reproduzimos o mesmo estado.
  // Atenção: no PGlite não há volta de `session authorization`; por isso a ordem destes testes
  // importa (dono primeiro, sessão do worker por último).
  it("a partida FALHA como dono (postgres)", async () => {
    await expect(assertWorkerRole(pgliteClient(db))).rejects.toThrow(/role/);
  });

  it("a configuração da role leva a sessão a service_role (RLS ignorado como no Supabase)", async () => {
    const r = await db.query<{ cfg: string[] }>("select rolconfig as cfg from pg_roles where rolname = 'achadinhos_worker'");
    expect(r.rows[0]!.cfg).toContain("role=service_role");
  });

  it("como achadinhos_worker: partida passa; claim/finish pelas RPCs; segredo lido; sem costura nem vault direto", async () => {
    const s = await seedAccount(db, 7);
    await db.query("insert into public.sends (account_id, channel_id, idempotency_key) values ($1,$2,'w-1')", [s.accountId, s.channelId]);
    await db.exec("set session authorization achadinhos_worker");
    await db.exec("set role service_role");

    await expect(assertWorkerRole(pgliteClient(db))).resolves.toBe("achadinhos_worker");
    const q = new PgQueue(pgliteClient(db));
    const c = await q.claimNextSend(s.channelId);
    expect(c).not.toBeNull();
    expect(await q.finishSend(c!.id, { status: "failed", reason: "x" })).toBe(true);
    const sec = await db.query<{ v: string }>("select public.worker_read_secret($1::uuid) as v", [s.botTokenSecretId]);
    expect(sec.rows).toHaveLength(1);
    await expect(db.query("select * from queue_internal.claim_next_send_at($1::uuid, now())", [s.channelId])).rejects.toThrow(/permission denied/);
    await expect(db.query("select * from vault.decrypted_secrets")).rejects.toThrow(/permission denied/);
  });
});
