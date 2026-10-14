import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createMigratedDb } from "./pglite-harness.js";
import { SqlCommissionRepository } from "./sql-repository.js";
import { CommissionCollector } from "../collector.js";
import type { Commission, ConversionReportPage } from "../types.js";

const ACC_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ACC_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const T0 = 1_760_000_000; // 2025-10-09T08:53:20Z

let db: PGlite;

function commission(over: Partial<Commission> = {}): Commission {
  return {
    checkoutId: "c-1",
    subIds: [ACC_A, "auto-1", "grp-ofertas", "chan-1", "send-1"],
    purchaseTime: T0,
    estimatedCommission: 10,
    status: "pending",
    ...over,
  };
}

beforeAll(async () => {
  db = await createMigratedDb();
  await db.exec(`
    INSERT INTO auth.users (id, aud, role, email) VALUES
      ('11111111-1111-1111-1111-111111111111','authenticated','authenticated','a@t.com'),
      ('22222222-2222-2222-2222-222222222222','authenticated','authenticated','b@t.com');
    INSERT INTO public.accounts (account_id, user_id) VALUES
      ('${ACC_A}','11111111-1111-1111-1111-111111111111'),
      ('${ACC_B}','22222222-2222-2222-2222-222222222222');
  `);
}, 60_000);

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.exec(`
    SET session_replication_role = replica;
    TRUNCATE public.commission_events, public.commissions, public.commission_checkpoints;
    SET session_replication_role = origin;
  `);
});

const repoA = () => new SqlCommissionRepository(db, ACC_A);
const repoB = () => new SqlCommissionRepository(db, ACC_B);

async function count(table: string): Promise<number> {
  const r = await db.query<{ n: number }>(`select count(*)::int n from public.${table}`);
  return r.rows[0]?.n ?? -1;
}

describe("persistência idempotente por (account_id, checkout_id)", () => {
  it("insere uma vez e reporta duplicata nas repetições", async () => {
    const repo = repoA();
    expect(await repo.save(commission())).toMatchObject({ inserted: true, duplicate: false });
    expect(await repo.save(commission())).toMatchObject({ inserted: false, updated: false, duplicate: true });
    expect(await count("commissions")).toBe(1);
    expect(await count("commission_events")).toBe(1);
  });

  it("guarda a hora da compra em UTC e os sub_ids", async () => {
    await repoA().save(commission());
    const r = await db.query<{ t: string; s: string[] }>(
      `select to_char(purchase_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') t, sub_ids s from public.commissions`,
    );
    expect(r.rows[0]).toEqual({ t: "2025-10-09T08:53:20Z", s: commission().subIds });
  });

  it("o mesmo checkout_id em contas distintas são registros distintos", async () => {
    await repoA().save(commission());
    await repoB().save(commission({ subIds: [ACC_B, "a", "g", "c", "s"] }));
    expect(await count("commissions")).toBe(2);
  });

  it("chamadas concorrentes com o mesmo checkout geram um registro e um evento", async () => {
    const repo = repoA();
    const results = await Promise.all(Array.from({ length: 6 }, () => repo.save(commission())));
    expect(results.filter((r) => r.inserted)).toHaveLength(1);
    expect(await count("commissions")).toBe(1);
    expect(await count("commission_events")).toBe(1);
  });
});

describe("histórico de status (só inserção)", () => {
  it("avanço de status anexa eventos e a visão corrente mostra o último", async () => {
    const repo = repoA();
    await repo.save(commission());
    const r1 = await repo.save(commission({ status: "confirmed" }));
    expect(r1).toMatchObject({ updated: true, previousStatus: "pending" });
    await repo.save(commission({ status: "paid" }));

    const hist = await db.query<{ s: string }>(
      `select status s from public.commission_events order by seq`,
    );
    expect(hist.rows.map((x) => x.s)).toEqual(["pending", "confirmed", "paid"]);
    const cur = await db.query<{ status: string }>(`select status from public.commission_current`);
    expect(cur.rows).toEqual([{ status: "paid" }]);
  });

  it("dado antigo não reverte status mais avançado", async () => {
    const repo = repoA();
    await repo.save(commission({ status: "paid" }));
    const r = await repo.save(commission({ status: "pending" }));
    expect(r).toMatchObject({ updated: false, duplicate: true });
    expect(await count("commission_events")).toBe(1);
  });

  it("cancelada é terminal", async () => {
    const repo = repoA();
    await repo.save(commission({ status: "cancelled" }));
    const r = await repo.save(commission({ status: "confirmed" }));
    expect(r.updated).toBe(false);
    const cur = await db.query<{ status: string }>(`select status from public.commission_current`);
    expect(cur.rows[0]?.status).toBe("cancelled");
  });

  it("mudança de valor com o mesmo status vira novo evento", async () => {
    const repo = repoA();
    await repo.save(commission());
    const r = await repo.save(commission({ estimatedCommission: 12.5 }));
    expect(r.updated).toBe(true);
    const cur = await db.query<{ v: string }>(`select estimated_commission::text v from public.commission_current`);
    expect(cur.rows[0]?.v).toBe("12.5");
    expect(await count("commission_events")).toBe(2);
  });

  it("commissions e commission_events são imutáveis (UPDATE/DELETE bloqueados)", async () => {
    await repoA().save(commission());
    await expect(db.exec(`update public.commissions set estimated_commission = 999`)).rejects.toThrow(/insert-only/);
    await expect(db.exec(`delete from public.commissions`)).rejects.toThrow(/insert-only/);
    await expect(db.exec(`update public.commission_events set status = 'paid'`)).rejects.toThrow(/insert-only/);
    await expect(db.exec(`delete from public.commission_events`)).rejects.toThrow(/insert-only/);
  });

  it("rejeita status fora do domínio", async () => {
    await expect(repoA().save(commission({ status: "weird" }))).rejects.toThrow();
  });
});

describe("soma por sub_id (grupo) para o Painel", () => {
  it("soma o valor corrente por grupo, ignora canceladas e isola por conta", async () => {
    const repo = repoA();
    await repo.save(commission({ checkoutId: "1", estimatedCommission: 10 }));
    await repo.save(commission({ checkoutId: "1", estimatedCommission: 15, status: "confirmed" }));
    await repo.save(commission({ checkoutId: "2", estimatedCommission: 5 }));
    await repo.save(commission({ checkoutId: "3", estimatedCommission: 100, status: "cancelled" }));
    await repo.save(commission({ checkoutId: "4", estimatedCommission: 7, subIds: [ACC_A, "a", "grp-moda", "c", "s"] }));
    await repoB().save(commission({ checkoutId: "9", estimatedCommission: 1000, subIds: [ACC_B, "a", "grp-ofertas", "c", "s"] }));

    const totals = await repo.totalsBySubId();
    expect(totals).toEqual([
      { subId: "grp-ofertas", total: 20, conversions: 2 },
      { subId: "grp-moda", total: 7, conversions: 1 },
    ]);
  });

  it("filtra por período de compra (UTC, [from, to))", async () => {
    const repo = repoA();
    await repo.save(commission({ checkoutId: "old", purchaseTime: T0 - 86_400, estimatedCommission: 3 }));
    await repo.save(commission({ checkoutId: "new", purchaseTime: T0, estimatedCommission: 4 }));
    const totals = await repo.totalsBySubId({ fromSeconds: T0, toSeconds: T0 + 60 });
    expect(totals).toEqual([{ subId: "grp-ofertas", total: 4, conversions: 1 }]);
  });
});

describe("isolamento por conta (RLS) no Painel", () => {
  async function asUser<T>(uid: string, fn: () => Promise<T>): Promise<T> {
    await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${uid}',false);`);
    try {
      return await fn();
    } finally {
      await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','',false);`);
    }
  }

  it("usuário só soma as comissões da própria conta e não grava direto", async () => {
    await repoA().save(commission({ estimatedCommission: 8 }));
    const sum = (acc: string) =>
      db.query<{ sub_id: string; total: string }>(
        `select sub_id, total::text from public.commission_totals_by_sub_id('${acc}')`,
      );
    const own = await asUser("11111111-1111-1111-1111-111111111111", () => sum(ACC_A));
    expect(own.rows).toEqual([{ sub_id: "grp-ofertas", total: "8" }]);
    const other = await asUser("22222222-2222-2222-2222-222222222222", () => sum(ACC_A));
    expect(other.rows).toEqual([]);
    await expect(
      asUser("11111111-1111-1111-1111-111111111111", () =>
        db.query(`select * from public.record_commission('${ACC_A}','x',null,now(),1,'pending')`),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("checkpoint da coleta", () => {
  it("começa vazio, grava e nunca regride", async () => {
    const repo = repoA();
    expect(await repo.getLastCollectedAt()).toBeNull();
    await repo.setLastCollectedAt(T0);
    await repo.setLastCollectedAt(T0 - 100);
    expect(await repo.getLastCollectedAt()).toBe(T0);
    expect(await repoB().getLastCollectedAt()).toBeNull();
  });
});

describe("coletor com repositório SQL", () => {
  function pagedSource(pages: ConversionReportPage[]) {
    let i = 0;
    return {
      calls: [] as unknown[],
      async conversionReport(params: unknown) {
        this.calls.push(params);
        return pages[i++] ?? { nodes: [], pageInfo: { hasNextPage: false, scrollId: "" } };
      },
    };
  }
  const node = (id: string, status: string, v: number) => ({
    purchaseTime: T0,
    conversionId: id,
    totalCommission: String(v),
    utmContent: "",
    subIds: [ACC_A, "auto-1", "grp-ofertas", "chan-1", "send-1"],
    orders: [{ orderStatus: status }],
  });

  it("duas rodadas sobre os mesmos dados não duplicam; status avança gera histórico", async () => {
    const repo = repoA();
    const run = async (status: string) => {
      const src = pagedSource([
        { nodes: [node("x1", status, 10)], pageInfo: { hasNextPage: true, scrollId: "s1", limit: 1 } },
        { nodes: [node("x2", status, 5)], pageInfo: { hasNextPage: false, scrollId: "", limit: 1 } },
      ]);
      return new CommissionCollector(src, repo, { accountId: ACC_A, now: () => T0 + 10 }).collect();
    };
    const r1 = await run("PENDING");
    expect(r1).toMatchObject({ inserted: 2, total: 2, pages: 2 });
    const r2 = await run("PENDING");
    expect(r2).toMatchObject({ inserted: 0, skipped: 2 });
    const r3 = await run("COMPLETED");
    expect(r3).toMatchObject({ updated: 2 });
    expect(await count("commissions")).toBe(2);
    expect(await count("commission_events")).toBe(4);
    expect(await repo.getLastCollectedAt()).toBe(T0 + 10);
  });

  it("a segunda coleta começa no checkpoint menos a sobreposição", async () => {
    const repo = repoA();
    const src = pagedSource([]);
    const c = new CommissionCollector(src, repo, { accountId: ACC_A, now: () => T0 + 1000, overlapSeconds: 600 });
    await c.collect();
    await c.collect();
    const second = src.calls[1] as { purchaseTimeStart: number };
    expect(second.purchaseTimeStart).toBe(T0 + 1000 - 600);
  });
});
