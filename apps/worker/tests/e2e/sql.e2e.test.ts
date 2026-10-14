import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createShopeeClient } from "@achadinhos/shopee";
import { startMockShopeeServer } from "@achadinhos/shopee/testing";
import { createMockTelegramServer, TelegramClient } from "@achadinhos/telegram";
import { createInMemoryEmailTransport } from "@achadinhos/alerts";
import { renderCreativePng } from "@achadinhos/creative/render";
import { productPlaceholder } from "@achadinhos/creative";
import { createDb } from "../sql/pglite-db.js";
import { pgliteClient } from "../sql/pglite-client.js";
import { BOT_TOKEN, seedAccount, type Seed } from "../sql/fixtures.js";
import { createSqlBuildDeps } from "../../src/sql/build-deps.js";
import { createWorkerRuntime } from "../../src/runtime.js";
import { loadConfig } from "../../src/config.js";

/**
 * T7-12 (ligação): o MESMO roteiro do pipeline em memória, agora com o worker montado pelos
 * adaptadores Postgres (createSqlBuildDeps) sobre o Postgres embutido com as migrações reais.
 * Shopee e Telegram são os servidores simulados; nada sai da máquina.
 */
const env = {
  DATABASE_URL: "postgresql://achadinhos_worker:x@127.0.0.1:5432/postgres",
  ALERT_EMAIL_TO: "ops@example.com",
  SUPABASE_URL: "https://proj.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-NAO-REAL",
  AFFILIATE_HANDLE: "achadinhos",
};

let db: PGlite;
let seed: Seed;
let shopeeServer: Awaited<ReturnType<typeof startMockShopeeServer>>;
const tg = createMockTelegramServer();
const subIds: string[][] = [];
const seenTokens: string[] = [];
const stored: string[] = [];
const transport = createInMemoryEmailTransport();
let productPng: Uint8Array;

beforeAll(async () => {
  db = await createDb();
  seed = await seedAccount(db, 1);
  // a conta do mock da Shopee usa app/secret próprios: regrava a credencial no Vault
  await db.query("update vault.secrets set secret = $2 where id = $1", [seed.shopeeSecretId, "sec"]);
  await db.query("update public.shopee_credentials set app_id = 'app' where account_id = $1", [seed.accountId]);
  await db.query("update public.automations set window_start = '00:00', window_end = '23:59', frequency_min = 60, filters = '{}' where id = $1", [seed.automationId]);
  shopeeServer = await startMockShopeeServer({ appId: "app", secret: "sec" });
  productPng = await renderCreativePng({
    title: "foto", imageUrl: productPlaceholder(200, "foto"), priceCurrent: 10, priceOld: 20, discountPct: 50, affiliateHandle: "x",
  });
  // como em produção: a conexão do worker é achadinhos_worker (sessão assume service_role)
  await db.exec("set session authorization achadinhos_worker");
  await db.exec("set role service_role");
}, 90_000);
afterAll(async () => {
  await shopeeServer?.close();
  await db?.close();
});

async function makeRuntime() {
  const config = loadConfig(env);
  const build = createSqlBuildDeps({
    env,
    db: pgliteClient(db),
    makeShopee: (cred) => {
      expect(cred.appId).toBe("app");
      const c = createShopeeClient({ appId: cred.appId, secret: cred.secret.reveal() }, { endpoint: shopeeServer.url, timeoutMs: 2_000 });
      const real = c.generateShortLink.bind(c);
      c.generateShortLink = async (p) => (subIds.push([...(p.subIds ?? [])]), real(p));
      return c;
    },
    makeTelegram: (token) => {
      seenTokens.push(token.reveal());
      return new TelegramClient({ transport: tg.transport });
    },
    emailTransport: transport,
    creativeStore: {
      put: async (_png, id) => (stored.push(id), { photoUrl: `https://signed.example/${id}?t=x`, objectPath: `${id}.png` }),
    },
    fetchImage: (async () => new Response(productPng as unknown as BodyInit, { headers: { "content-type": "image/png" } })) as unknown as typeof fetch,
    imageHosts: ["example.com"],
  });
  const log = { debug() {}, info() {}, warn() {}, error() {}, addSecret() {} };
  const parts = await build(config, log);
  return createWorkerRuntime({
    config: { tickIntervalMs: 60_000, executorPollMs: 5_000, stallAlertMs: 600_000, shutdownGraceMs: 1_000 },
    log,
    ...parts,
  });
}

const rows = async () =>
  (await db.query<{ status: string; reason: string | null; short_link: string | null; external_message_id: string | null; idempotency_key: string }>(
    "select status, reason, short_link, external_message_id, idempotency_key from public.sends where group_id = $1 order by created_at",
    [seed.groupId],
  )).rows;

describe("e2e contra Postgres (adaptadores SQL ligados ao runtime)", () => {
  it("automação -> oferta -> link curto -> criativo -> sendPhoto -> sent; reexecução não duplica", async () => {
    const rt = await makeRuntime();

    await rt.tickOnce(); // next_run_at nulo => inicializa
    expect(await rows()).toHaveLength(0);
    await db.query("update public.automation_groups set next_run_at = now() - interval '1 minute' where group_id = $1", [seed.groupId]);

    await rt.tickOnce(); // enfileira no slot
    let r = await rows();
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ status: "queued", reason: null });
    expect(r[0]!.idempotency_key.startsWith(`${seed.automationId}:${seed.groupId}:`)).toBe(true);

    await rt.executorOnce(); // claim -> executor -> finish_send
    r = await rows();
    expect(r[0]!.status).toBe("sent");
    expect(r[0]!.short_link).toMatch(/^https:\/\//);
    expect(r[0]!.external_message_id).toBeTruthy();
    expect(seenTokens).toEqual([BOT_TOKEN]);
    expect(tg.getSentMessages().filter((m) => m.method === "sendPhoto")).toHaveLength(1);
    // subIds: conta, automação, sub_id do grupo, canal, send
    expect(subIds[0]![0]).toBe(seed.accountId);
    expect(subIds[0]![1]).toBe(seed.automationId);
    expect(subIds[0]![3]).toBe(seed.channelId);

    // reexecução 2x: sem envio duplo (mesma chave de slot; 60 s no banco)
    await db.query("update public.automation_groups set next_run_at = now() - interval '1 minute' where group_id = $1", [seed.groupId]);
    await rt.tickOnce();
    await rt.executorOnce();
    await rt.executorOnce();
    expect(await rows()).toHaveLength(1);
    expect(tg.getSentMessages().filter((m) => m.method === "sendPhoto")).toHaveLength(1);
  }, 60_000);

  it("bot sem acesso: groups.deactivate desativa o grupo e pula os queued dele (grupo_inativo)", async () => {
    await db.query(
      "insert into public.sends (account_id, group_id, channel_id, idempotency_key) values ($1,$2,$3,'e2e-queued-1')",
      [seed.accountId, seed.groupId, seed.channelId],
    );
    const log = { debug() {}, info() {}, warn() {}, error() {}, addSecret() {} };
    const parts = await createSqlBuildDeps({ env, db: pgliteClient(db), emailTransport: transport, creativeStore: { put: async () => ({ photoUrl: "https://x", objectPath: "x" }) } })(loadConfig(env), log);
    await parts.groups.deactivate(seed.groupId, "telegram_bot_removido");
    const g = await db.query<{ active: boolean }>("select active from public.groups where id = $1", [seed.groupId]);
    expect(g.rows[0]!.active).toBe(false);
    const s = await db.query<{ status: string; reason: string }>("select status, reason from public.sends where idempotency_key = 'e2e-queued-1'");
    expect(s.rows[0]).toEqual({ status: "skipped", reason: "grupo_inativo" });
    // grupo inativo sai do agendador
    const due = await new (await import("../../src/sql/scheduler-store.js")).PgSchedulerStore(pgliteClient(db)).listDueGroups(new Date(Date.now() + 86_400_000), 100);
    expect(due.map((d) => d.groupId)).not.toContain(seed.groupId);
  });

  it("buildDeps recusa partir como dono do banco (postgres)", async () => {
    const owner = await createDb(); // sessão nova: dono (postgres)
    try {
      await expect(
        createSqlBuildDeps({ env, db: pgliteClient(owner), emailTransport: transport })(loadConfig(env), { debug() {}, info() {}, warn() {}, error() {}, addSecret() {} }),
      ).rejects.toThrow(/role/);
    } finally {
      await owner.close();
    }
  }, 60_000);
});
