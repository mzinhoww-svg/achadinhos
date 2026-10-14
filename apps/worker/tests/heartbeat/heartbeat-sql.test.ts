import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqlHeartbeatStore } from "../../src/heartbeat-store.js";

const MIGRATION = new URL(
  "../../../../supabase/migrations/20261015120000_t7_worker_heartbeats.sql",
  import.meta.url,
);

// Postgres embutido (WASM), sem Docker: só a migração do heartbeat, que é autocontida.
let db: PGlite;

beforeEach(async () => {
  db = new PGlite();
  await db.exec(
    "CREATE ROLE service_role NOLOGIN; CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;",
  );
  await db.exec(readFileSync(MIGRATION, "utf8"));
});

afterEach(async () => {
  await db.close();
});

describe("worker_heartbeats (SQL)", () => {
  it("sem nenhum batimento a idade é null (falha fechada no monitor)", async () => {
    const store = new SqlHeartbeatStore(db);
    expect(await store.ageMs()).toBeNull();
  });

  it("record grava com o relógio do banco e ageMs é calculada no banco", async () => {
    const store = new SqlHeartbeatStore(db);
    await store.record("worker-a");
    const age = await store.ageMs();
    expect(age).not.toBeNull();
    expect(age!).toBeGreaterThanOrEqual(0);
    expect(age!).toBeLessThan(5_000);
  });

  it("record é upsert por worker e conta ticks", async () => {
    const store = new SqlHeartbeatStore(db);
    await store.record("worker-a");
    await store.record("worker-a");
    const r = await db.query<{ n: number; ticks: number }>(
      "SELECT count(*)::int AS n, max(tick_count)::int AS ticks FROM public.worker_heartbeats",
    );
    expect(r.rows[0]).toEqual({ n: 1, ticks: 2 });
  });

  it("com deploy sobreposto vale o batimento mais recente entre workers", async () => {
    const store = new SqlHeartbeatStore(db);
    await store.record("old");
    await db.query(
      "UPDATE public.worker_heartbeats SET beat_at = now() - interval '1 hour' WHERE worker_id = 'old'",
    );
    expect((await store.ageMs())!).toBeGreaterThan(3_000_000);
    await store.record("new");
    expect((await store.ageMs())!).toBeLessThan(5_000);
  });

  it("rejeita worker_id vazio", async () => {
    const store = new SqlHeartbeatStore(db);
    await expect(store.record("")).rejects.toThrow();
  });

  it("anon/authenticated não leem nem escrevem; service_role executa", async () => {
    await db.exec("SET ROLE authenticated");
    await expect(db.query("SELECT * FROM public.worker_heartbeats")).rejects.toThrow();
    await expect(db.query("SELECT public.record_worker_heartbeat('x')")).rejects.toThrow();
    await db.exec("RESET ROLE; SET ROLE anon");
    await expect(db.query("SELECT public.worker_heartbeat_age_ms()")).rejects.toThrow();
    await db.exec("RESET ROLE; SET ROLE service_role");
    await expect(db.query("SELECT public.record_worker_heartbeat('x')")).resolves.toBeDefined();
    await expect(db.query("SELECT public.worker_heartbeat_age_ms()")).resolves.toBeDefined();
  });
});
