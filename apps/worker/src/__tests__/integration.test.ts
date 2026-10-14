import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClock } from "@achadinhos/domain";
import { createShopeeClient, startMockServer } from "@achadinhos/shopee";
import { createOfferSelector } from "../offer-selection.js";
import { runSchedulerTick } from "../scheduler.js";
import { MemoryStore } from "../memory-store.js";
import { CUIABA } from "./helpers.js";

let mock: Awaited<ReturnType<typeof startMockServer>>;
beforeAll(async () => {
  mock = await startMockServer();
});
afterAll(async () => {
  await mock.close();
});

function world(start: string) {
  const store = new MemoryStore();
  store.addAutomation({
    id: "a1", accountId: "acc", status: "active", days: [0, 1, 2, 3, 4, 5, 6],
    windowStart: "08:00", windowEnd: "20:00", frequencyMin: 60, filters: {}, timezone: CUIABA,
  });
  store.addGroup({ automationId: "a1", groupId: "g1", accountId: "acc", channelId: "c1", active: true, nextRunAt: new Date(start) });
  return { store, clock: createClock(new Date(start)) };
}

describe("T7-04 + T7-05 com cliente Shopee real contra o servidor simulado", () => {
  it("seleciona oferta pelo cliente de packages/shopee, reexecuta 2x sem duplicata e libera no dia 8", async () => {
    const shopee = createShopeeClient({ appId: "test-app-id", secret: "test-secret" }, { endpoint: mock.url, timeoutMs: 2_000 });
    const selectOffer = createOfferSelector(shopee, { timeoutMs: 5_000 });
    const w = world("2026-10-13T16:00:00Z");
    const run = () => runSchedulerTick({ store: w.store, now: w.clock.now, selectOffer, dedupeDays: 7 });
    const sentItems = () => w.store.sends.filter((s) => s.status === "queued" || s.status === "sent");

    // dia 0: envia a única oferta do fixture
    await run();
    await run(); // reexecução
    expect(w.store.sends).toHaveLength(1);
    const first = w.store.sends[0]!;
    expect(first.status).toBe("queued");
    first.status = "sent";
    first.sentAt = w.clock.now();

    // dia 3 (próximo slot): mesma oferta repetida ⇒ skipped/repetida, sem novo envio
    w.clock.set(new Date("2026-10-16T16:00:00Z"));
    w.store.group("a1", "g1").nextRunAt = w.clock.now();
    await run();
    await run();
    expect(sentItems()).toHaveLength(1);
    expect(w.store.sends.at(-1)).toMatchObject({ status: "skipped", reason: "repetida" });

    // dia 8: a antirrepetição venceu
    w.clock.set(new Date("2026-10-21T16:00:00Z"));
    w.store.group("a1", "g1").nextRunAt = w.clock.now();
    await run();
    await run();
    expect(w.store.sends.at(-1)).toMatchObject({ status: "queued" });
    expect(sentItems()).toHaveLength(2);
  });

  it("Shopee que não responde estoura o prazo total e o grupo não avança", async () => {
    const hang = { productOfferV2: () => new Promise<never>(() => {}) };
    const w = world("2026-10-13T16:00:00Z");
    const r = await runSchedulerTick({
      store: w.store,
      now: w.clock.now,
      selectOffer: createOfferSelector(hang, { timeoutMs: 30 }),
    });
    expect(r.errors).toBe(1);
    expect(w.store.sends).toHaveLength(0);
    expect(w.store.group("a1", "g1").nextRunAt!.toISOString()).toBe("2026-10-13T16:00:00.000Z");
  });
});
