import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createDb } from "./sql/pglite-db.js";
import { asOwner, pgliteClient } from "./sql/pglite-client.js";
import { BOT_TOKEN, SHOPEE_SECRET, seedAccount, type Seed } from "./sql/fixtures.js";
import { PgSecretVault } from "../src/sql/vault.js";
import { PgSendContext } from "../src/sql/send-context.js";
import { PgQueue } from "../src/sql/queue.js";
import { Secret } from "../src/config.js";

let db: PGlite;
let n = 900;
beforeAll(async () => {
  db = await createDb();
  await db.exec("set role service_role");
}, 60_000);
afterAll(async () => db?.close());

const fresh = (): Promise<Seed> => asOwner(db, () => seedAccount(db, ++n));
const own = <T extends object>(sql: string, p: unknown[] = []) => asOwner(db, async () => (await db.query<T>(sql, p)).rows);
const client = () => pgliteClient(db);

describe("PgSecretVault (T7-12: Vault só pelo worker)", () => {
  it("lê o segredo pelo id; id inexistente devolve null", async () => {
    const s = await fresh();
    const v = new PgSecretVault(client());
    expect(await v.read(s.botTokenSecretId)).toBe(BOT_TOKEN);
    expect(await v.read("00000000-0000-4000-8000-000000000000")).toBeNull();
  });

  it("anon e authenticated não executam a RPC; service_role sim", async () => {
    const s = await fresh();
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await expect(db.query("select public.worker_read_secret($1::uuid)", [s.botTokenSecretId])).rejects.toThrow(/permission denied/);
    }
    await db.exec("set role service_role");
    const r = await db.query<{ v: string }>("select public.worker_read_secret($1::uuid) as v", [s.botTokenSecretId]);
    expect(r.rows[0]!.v).toBe(BOT_TOKEN);
  });
});

describe("PgSendContext", () => {
  it("shopeeCredential: appId + segredo embrulhado em Secret (não vaza em JSON/log)", async () => {
    const s = await fresh();
    const ctx = new PgSendContext(client(), { affiliateHandle: () => "achadinhos" });
    const cred = (await ctx.shopeeCredential(s.accountId))!;
    expect(cred.appId).toBe("app-1");
    expect(cred.secret).toBeInstanceOf(Secret);
    expect(cred.secret.reveal()).toBe(SHOPEE_SECRET);
    expect(JSON.stringify(cred)).not.toContain(SHOPEE_SECRET);
    expect(`${cred.secret}`).not.toContain(SHOPEE_SECRET);
  });

  it("shopeeCredential: conta sem credencial => null", async () => {
    const s = await fresh();
    await own("delete from public.shopee_credentials where account_id = $1", [s.accountId]);
    expect(await new PgSendContext(client(), { affiliateHandle: () => "x" }).shopeeCredential(s.accountId)).toBeNull();
  });

  it("telegramToken: lê o token do canal; canal inexistente => null", async () => {
    const s = await fresh();
    const ctx = new PgSendContext(client(), { affiliateHandle: () => "x" });
    expect((await ctx.telegramToken(s.channelId, s.accountId))!.reveal()).toBe(BOT_TOKEN);
    expect(await ctx.telegramToken("00000000-0000-4000-8000-000000000000", s.accountId)).toBeNull();
  });

  it("telegramToken: canal de outra conta nunca entrega o segredo", async () => {
    const a = await fresh();
    const b = await fresh();
    const ctx = new PgSendContext(client(), { affiliateHandle: () => "x" });
    expect(await ctx.telegramToken(b.channelId, a.accountId)).toBeNull();
  });

  async function claimed(s: Seed, key: string, withOffer = true) {
    let offerId: string | null = null;
    if (withOffer) {
      offerId = (
        await own<{ id: string }>(
          `insert into public.offers (account_id, item_id, title, price, original_price, discount_pct, image_url, product_url)
           values ($1, $2, 'Fone Top', 49.9, 99.8, 50, 'https://cf.shopee.com.br/file/1', 'https://shopee.com.br/p-1') returning id`,
          [s.accountId, `it-${Math.random()}`],
        )
      )[0]!.id;
    }
    const id = (
      await own<{ id: string }>(
        `insert into public.sends (account_id, group_id, channel_id, offer_id, idempotency_key)
         values ($1,$2,$3,$4,$5) returning id`,
        [s.accountId, s.groupId, s.channelId, offerId, key],
      )
    )[0]!.id;
    await new PgQueue(client()).claimNextSend(s.channelId);
    return { id, offerId };
  }

  it("loadClaimedSend monta o ClaimedSend do executor (automação vem da chave do slot)", async () => {
    const s = await fresh();
    const { id, offerId } = await claimed(s, `${s.automationId}:${s.groupId}:2026-10-14T15:00:00.000Z`);
    const ctx = new PgSendContext(client(), { affiliateHandle: (acc) => (acc === s.accountId ? "meu_handle" : "?") });
    expect(await ctx.loadClaimedSend(id)).toEqual({
      sendId: id,
      accountId: s.accountId,
      automationId: s.automationId,
      groupId: s.groupId,
      groupSubId: expect.stringMatching(/^g\d+$/),
      channelId: s.channelId,
      offerId,
      chatId: -1001234567890,
      affiliateHandle: "meu_handle",
      offer: {
        title: "Fone Top",
        imageUrl: "https://cf.shopee.com.br/file/1",
        productUrl: "https://shopee.com.br/p-1",
        priceCurrent: 49.9,
        priceOld: 99.8,
        discountPct: 50,
      },
    });
  });

  it("'Mandar agora' (chave now:) é manual: nunca vira a automação do grupo (comissão)", async () => {
    const s = await fresh(); // o grupo TEM uma automação ligada
    const { id } = await claimed(s, `now:${s.groupId}:oferta:29000000`);
    const got = await new PgSendContext(client(), { affiliateHandle: () => "h" }).loadClaimedSend(id);
    expect(got?.automationId).toBe("manual");
  });

  it("chave sem UUID de automação => manual", async () => {
    const s = await fresh();
    const { id } = await claimed(s, "qualquer-coisa");
    expect((await new PgSendContext(client(), { affiliateHandle: () => "h" }).loadClaimedSend(id))?.automationId).toBe("manual");
  });

  it("chat @canal permanece string", async () => {
    const s = await fresh();
    await own("update public.groups set external_id = '@meucanal' where id = $1", [s.groupId]);
    const { id } = await claimed(s, `${s.automationId}:${s.groupId}:2026-10-14T16:00:00.000Z`);
    const got = await new PgSendContext(client(), { affiliateHandle: () => "h" }).loadClaimedSend(id);
    expect(got?.chatId).toBe("@meucanal");
  });

  it("null quando o send não está em sending, não existe ou perdeu a oferta", async () => {
    const s = await fresh();
    const ctx = new PgSendContext(client(), { affiliateHandle: () => "h" });
    expect(await ctx.loadClaimedSend("00000000-0000-4000-8000-000000000000")).toBeNull();
    const noOffer = await claimed(s, `${s.automationId}:${s.groupId}:2026-10-14T17:00:00.000Z`, false);
    expect(await ctx.loadClaimedSend(noOffer.id)).toBeNull();
    const queued = (
      await own<{ id: string }>(
        "insert into public.sends (account_id, group_id, channel_id, idempotency_key) values ($1,$2,$3,'q-1') returning id",
        [s.accountId, s.groupId, s.channelId],
      )
    )[0]!;
    expect(await ctx.loadClaimedSend(queued.id)).toBeNull();
  });
});
