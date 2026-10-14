import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createDb } from "./sql/pglite-db.js";
import { asOwner, pgliteClient } from "./sql/pglite-client.js";
import { seedAccount, type Seed } from "./sql/fixtures.js";
import { PgSchedulerStore } from "../src/sql/scheduler-store.js";
import { runSchedulerTick, idempotencyKey, slotOf } from "../src/scheduler.js";
import type { ProductOfferNode } from "../src/scheduler-ports.js";

const NOW = new Date("2026-10-14T15:07:00Z");

const node = (itemId: number): ProductOfferNode =>
  ({
    itemId,
    productName: `Fone ${itemId}`,
    productLink: `https://shopee.com.br/p-${itemId}`,
    offerLink: `https://shope.ee/o-${itemId}`,
    imageUrl: `https://cf.shopee.com.br/file/${itemId}`,
    priceMin: 50,
    priceMax: 100,
    priceDiscountRate: 50,
    sales: 10,
    ratingStar: 4.8,
    commissionRate: "0.1",
    sellerCommissionRate: "0.05",
    shopeeCommissionRate: "0.05",
    commission: "5",
    shopId: 1,
    shopName: "Loja",
    shopType: 1,
    periodStartTime: 0,
    periodEndTime: 0,
  }) as ProductOfferNode;

let db: PGlite;
let n = 100;
beforeAll(async () => {
  db = await createDb();
  await db.exec("set role service_role");
}, 60_000);
afterAll(async () => db?.close());

const fresh = async (): Promise<Seed> => asOwner(db, () => seedAccount(db, ++n));
const store = () => new PgSchedulerStore(pgliteClient(db));
const own = <T extends object>(sql: string, p: unknown[] = []) => asOwner(db, async () => (await db.query<T>(sql, p)).rows);

describe("PgSchedulerStore.listDueGroups", () => {
  it("devolve grupo com next_run_at nulo e a automação normalizada (janela HH:MM, dias, fuso da conta)", async () => {
    const s = await fresh();
    const due = (await store().listDueGroups(NOW, 500)).find((d) => d.groupId === s.groupId)!;
    expect(due).toMatchObject({
      automationId: s.automationId,
      accountId: s.accountId,
      channelId: s.channelId,
      nextRunAt: null,
    });
    expect(due.automation).toMatchObject({
      id: s.automationId,
      status: "active",
      days: [0, 1, 2, 3, 4, 5, 6],
      windowStart: "00:00",
      windowEnd: "23:59",
      frequencyMin: 30,
      timezone: "America/Cuiaba",
      filters: { keywords: "fone" },
    });
  });

  it("ignora: next_run_at futuro, grupo inativo, automação pausada e arquivada", async () => {
    const future = await fresh();
    const inactive = await fresh();
    const paused = await fresh();
    await own("update public.automation_groups set next_run_at = $2 where group_id = $1", [future.groupId, new Date(NOW.getTime() + 60_000)]);
    await own("update public.groups set active = false where id = $1", [inactive.groupId]);
    await own("update public.automations set status = 'paused' where id = $1", [paused.automationId]);
    const ids = (await store().listDueGroups(NOW, 500)).map((d) => d.groupId);
    expect(ids).not.toContain(future.groupId);
    expect(ids).not.toContain(inactive.groupId);
    expect(ids).not.toContain(paused.groupId);
  });

  it("respeita o limite e inclui o vencido no instante exato", async () => {
    const s = await fresh();
    await own("update public.automation_groups set next_run_at = $2 where group_id = $1", [s.groupId, NOW]);
    const ids = (await store().listDueGroups(NOW, 500)).map((d) => d.groupId);
    expect(ids).toContain(s.groupId);
    expect(await store().listDueGroups(NOW, 1)).toHaveLength(1);
  });
});

describe("PgSchedulerStore: histórico e empilhamento", () => {
  it("listRecentSends traz item_id da oferta, status, motivo e datas; respeita 'since' e o grupo", async () => {
    const s = await fresh();
    const other = await fresh();
    const offer = (
      await own<{ id: string }>("insert into public.offers (account_id, item_id) values ($1,'9001') returning id", [s.accountId])
    )[0]!;
    await own(
      `insert into public.sends (account_id, group_id, channel_id, offer_id, status, attempted_at, finished_at, sent_at, created_at, scheduled_for, idempotency_key, external_message_id)
       values ($1,$2,$3,$4,'sent',$5,$5,$5,$5,$5,'h-new','m1')`,
      [s.accountId, s.groupId, s.channelId, offer.id, new Date("2026-10-13T10:00:00Z")],
    );
    await own(
      `insert into public.sends (account_id, group_id, channel_id, status, reason, finished_at, created_at, scheduled_for, idempotency_key)
       values ($1,$2,$3,'skipped','sem_oferta',$4,$4,$4,'h-old')`,
      [s.accountId, s.groupId, s.channelId, new Date("2026-09-01T10:00:00Z")],
    );
    await own(
      `insert into public.sends (account_id, group_id, channel_id, status, reason, finished_at, created_at, scheduled_for, idempotency_key)
       values ($1,$2,$3,'skipped','x',$4,$4,$4,'h-other')`,
      [other.accountId, other.groupId, other.channelId, new Date("2026-10-13T10:00:00Z")],
    );

    const rows = await store().listRecentSends(s.groupId, new Date("2026-10-01T00:00:00Z"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      itemId: "9001",
      status: "sent",
      reason: null,
      sentAt: new Date("2026-10-13T10:00:00Z"),
      attemptedAt: new Date("2026-10-13T10:00:00Z"),
      createdAt: new Date("2026-10-13T10:00:00Z"),
    });
  });

  it("hasOpenSend vê queued/sending só da automação+grupo (pelo prefixo da chave)", async () => {
    const s = await fresh();
    const st = store();
    expect(await st.hasOpenSend(s.automationId, s.groupId)).toBe(false);
    await own(
      `insert into public.sends (account_id, group_id, channel_id, status, idempotency_key)
       values ($1,$2,$3,'queued',$4)`,
      [s.accountId, s.groupId, s.channelId, `${s.automationId}:${s.groupId}:2026-10-14T15:00:00.000Z`],
    );
    expect(await st.hasOpenSend(s.automationId, s.groupId)).toBe(true);
    // mesma conta, outra automação: não conta
    expect(await st.hasOpenSend("00000000-0000-4000-8000-000000000000", s.groupId)).toBe(false);
  });
});

describe("PgSchedulerStore.transaction", () => {
  it("lockGroup devolve o grupo vencido e nulo quando ainda não venceu", async () => {
    const s = await fresh();
    const st = store();
    const got = await st.transaction((tx) => tx.lockGroup(s.automationId, s.groupId, NOW));
    expect(got?.groupId).toBe(s.groupId);
    await own("update public.automation_groups set next_run_at = $2 where group_id = $1", [s.groupId, new Date(NOW.getTime() + 1000)]);
    expect(await st.transaction((tx) => tx.lockGroup(s.automationId, s.groupId, NOW))).toBeNull();
  });

  it("upsertOffer é idempotente por (conta,item) e grava os campos da oferta", async () => {
    const s = await fresh();
    const st = store();
    const a = await st.transaction((tx) => tx.upsertOffer(s.accountId, node(777)));
    const b = await st.transaction((tx) => tx.upsertOffer(s.accountId, node(777)));
    expect(b.id).toBe(a.id);
    const [row] = await own<Record<string, unknown>>(
      "select item_id, title, price::float8 as price, original_price::float8 as original_price, discount_pct::float8 as d, image_url, product_url from public.offers where id=$1",
      [a.id],
    );
    expect(row).toEqual({
      item_id: "777",
      title: "Fone 777",
      price: 50,
      original_price: 100,
      d: 50,
      image_url: "https://cf.shopee.com.br/file/777",
      product_url: "https://shopee.com.br/p-777",
    });
  });

  it("insertSend: 1ª vez true, mesma chave false; skipped nasce terminal (finished_at)", async () => {
    const s = await fresh();
    const st = store();
    const slot = slotOf(NOW, 30);
    const base = {
      accountId: s.accountId,
      automationId: s.automationId,
      groupId: s.groupId,
      channelId: s.channelId,
      offerId: null,
      idempotencyKey: idempotencyKey(s.automationId, s.groupId, slot),
      scheduledFor: slot,
    };
    expect(await st.transaction((tx) => tx.insertSend({ ...base, status: "skipped", reason: "sem_oferta" }))).toBe(true);
    expect(await st.transaction((tx) => tx.insertSend({ ...base, status: "skipped", reason: "sem_oferta" }))).toBe(false);
    const [r] = await own<{ status: string; reason: string; finished_at: Date | null; scheduled_for: Date }>(
      "select status, reason, finished_at, scheduled_for from public.sends where idempotency_key = $1",
      [base.idempotencyKey],
    );
    expect(r!.status).toBe("skipped");
    expect(r!.reason).toBe("sem_oferta");
    expect(r!.finished_at).toBeInstanceOf(Date);
    expect(r!.scheduled_for).toEqual(slot);
  });

  it("exceção na transação desfaz tudo (offer, send e next_run_at)", async () => {
    const s = await fresh();
    const st = store();
    await expect(
      st.transaction(async (tx) => {
        const o = await tx.upsertOffer(s.accountId, node(888));
        await tx.insertSend({
          accountId: s.accountId, automationId: s.automationId, groupId: s.groupId, channelId: s.channelId,
          offerId: o.id, status: "queued", reason: null, idempotencyKey: "rb-1", scheduledFor: NOW,
        });
        await tx.setNextRunAt(s.automationId, s.groupId, new Date(NOW.getTime() + 1800_000));
        throw new Error("falha injetada");
      }),
    ).rejects.toThrow("falha injetada");
    expect(await own("select 1 from public.sends where idempotency_key = 'rb-1'")).toHaveLength(0);
    expect(await own("select 1 from public.offers where account_id=$1 and item_id='888'", [s.accountId])).toHaveLength(0);
    const [g] = await own<{ next_run_at: Date | null }>("select next_run_at from public.automation_groups where group_id=$1", [s.groupId]);
    expect(g!.next_run_at).toBeNull();
  });
});

describe("runSchedulerTick sobre o Postgres (integração)", () => {
  it("inicializa, enfileira a oferta no slot, avança next_run_at e é idempotente", async () => {
    const s = await fresh();
    const st = store();
    const selectOffer = async () => ({ kind: "offer" as const, offer: node(4242) });
    const deps = { store: st, selectOffer, now: () => NOW, limit: 1000 };

    // 1º tick: next_run_at nulo => inicializa (não envia)
    const r1 = await runSchedulerTick(deps);
    expect(r1.errors).toBe(0);
    const [g1] = await own<{ next_run_at: Date | null }>("select next_run_at from public.automation_groups where group_id=$1", [s.groupId]);
    expect(g1!.next_run_at).toBeInstanceOf(Date);

    // 2º tick no instante do next_run_at: enfileira
    const due = g1!.next_run_at!;
    const r2 = await runSchedulerTick({ ...deps, now: () => due });
    expect(r2.errors).toBe(0);
    const sends = await own<{ status: string; offer_id: string; idempotency_key: string }>(
      "select status, offer_id, idempotency_key from public.sends where group_id=$1",
      [s.groupId],
    );
    expect(sends).toHaveLength(1);
    expect(sends[0]!.status).toBe("queued");
    expect(sends[0]!.idempotency_key.startsWith(`${s.automationId}:${s.groupId}:`)).toBe(true);

    // repetir o mesmo tick não duplica
    await runSchedulerTick({ ...deps, now: () => due });
    expect(await own("select 1 from public.sends where group_id=$1", [s.groupId])).toHaveLength(1);
  });
});
