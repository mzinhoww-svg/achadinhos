import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createShopeeClient } from "@achadinhos/shopee";
import type { ShopeeClient } from "@achadinhos/shopee";
import { startMockShopeeServer } from "@achadinhos/shopee/testing";
import { TelegramClient, createMockTelegramServer } from "@achadinhos/telegram";
import type { TelegramTransport } from "@achadinhos/telegram";

import { MemoryValidationStore, MemoryVault } from "../src/validation/memory.js";
import { runValidationOnce, startValidationLoop } from "../src/validation/runner.js";
import type { ValidationDeps } from "../src/validation/runner.js";
import type { ValidationTask } from "../src/validation/types.js";

const APP_ID = "app-123";
const SECRET = "canary-shopee-secret-9a8b7c";
const TOKEN = "123456789:AAH-canary-telegram-token-xyz_0123456789";
const T0 = new Date("2026-10-14T12:00:00.000Z");

const shopeeTask = (over: Partial<Extract<ValidationTask, { kind: "shopee_credential" }>> = {}) =>
  ({ kind: "shopee_credential", id: "cred-1", accountId: "acc-1", appId: APP_ID, secretId: "sec-1", attempts: 0, ...over }) as ValidationTask;
const channelTask = (over: Record<string, unknown> = {}) =>
  ({ kind: "telegram_channel", id: "ch-1", accountId: "acc-1", secretId: "sec-2", attempts: 0, ...over }) as ValidationTask;
const groupTask = (over: Record<string, unknown> = {}) =>
  ({ kind: "telegram_group", id: "grp-1", accountId: "acc-1", channelId: "ch-1", secretId: "sec-2", externalId: "-1001", attempts: 0, ...over }) as ValidationTask;

describe("validação de credenciais (T7-08)", () => {
  let shopee: Awaited<ReturnType<typeof startMockShopeeServer>>;
  let tg: ReturnType<typeof createMockTelegramServer>;
  let logs: string[];
  let vault: MemoryVault;
  let seenBodies: string[];

  const deps = (store: MemoryValidationStore, over: Partial<ValidationDeps> = {}): ValidationDeps => ({
    store,
    vault,
    now: () => T0,
    taskTimeoutMs: 1000,
    maxAttempts: 3,
    createShopee: (cred): ShopeeClient =>
      createShopeeClient(cred, {
        endpoint: shopee.url,
        timeoutMs: 800,
        fetch: (async (url: string, init: RequestInit) => {
          seenBodies.push(String(init.body));
          return fetch(url, init);
        }) as typeof fetch,
      }),
    createTelegram: (token) => new TelegramClient({ token, transport: tg.transport }),
    logger: {
      info: (m, c) => logs.push(JSON.stringify({ m, c })),
      warn: (m, c) => logs.push(JSON.stringify({ m, c })),
      error: (m, c) => logs.push(JSON.stringify({ m, c })),
    },
    ...over,
  });

  beforeEach(async () => {
    shopee = await startMockShopeeServer({ appId: APP_ID, secret: SECRET });
    tg = createMockTelegramServer();
    logs = [];
    seenBodies = [];
    vault = new MemoryVault({ "sec-1": SECRET, "sec-2": TOKEN });
  });
  afterEach(async () => {
    await shopee.close();
  });

  describe("Shopee", () => {
    it("credencial válida → validated com productOfferV2 limit 1", async () => {
      const store = new MemoryValidationStore([shopeeTask()]);
      await runValidationOnce(deps(store));
      const r = store.result("cred-1");
      expect(r.status).toBe("validated");
      expect(r.lastError).toBeNull();
      expect(r.validatedAt).toEqual(T0);
      expect(seenBodies).toHaveLength(1);
      expect(JSON.parse(seenBodies[0]!).variables).toEqual({ limit: 1 });
      expect(seenBodies[0]).toContain("productOfferV2");
    });

    it("secret errado → invalid com mensagem fixa e saneada", async () => {
      vault = new MemoryVault({ "sec-1": "wrong-secret-value", "sec-2": TOKEN });
      const store = new MemoryValidationStore([shopeeTask()]);
      await runValidationOnce(deps(store));
      const r = store.result("cred-1");
      expect(r.status).toBe("invalid");
      expect(r.lastError).toMatch(/credencial/i);
      expect(r.lastError).not.toContain("wrong-secret-value");
      expect(r.lastError).not.toContain(APP_ID);
    });

    it("401 com 10020 → invalid (não é indisponibilidade)", async () => {
      const store = new MemoryValidationStore([shopeeTask()]);
      await runValidationOnce(
        deps(store, {
          createShopee: (cred) =>
            createShopeeClient(cred, {
              endpoint: shopee.url,
              fetch: (async () =>
                new Response(
                  JSON.stringify({ errors: [{ message: `Invalid Signature for ${SECRET}`, extensions: { code: 10020 } }] }),
                  { status: 401 },
                )) as typeof fetch,
            }),
        }),
      );
      const r = store.result("cred-1");
      expect(r.status).toBe("invalid");
      expect(r.lastError).not.toContain(SECRET);
    });

    it("500 → volta a pending_validation com tentativa+1; ao esgotar vira invalid", async () => {
      const failing = (cred: { appId: string; secret: string }) =>
        createShopeeClient(cred, {
          endpoint: shopee.url,
          fetch: (async () => new Response(`boom ${SECRET}`, { status: 500 })) as typeof fetch,
        });
      const store = new MemoryValidationStore([shopeeTask()]);
      await runValidationOnce(deps(store, { createShopee: failing }));
      let r = store.result("cred-1");
      expect(r.status).toBe("pending_validation");
      expect(r.attempts).toBe(1);
      expect(r.lastError).not.toContain(SECRET);

      await runValidationOnce(deps(store, { createShopee: failing }));
      await runValidationOnce(deps(store, { createShopee: failing }));
      r = store.result("cred-1");
      expect(r.status).toBe("invalid");
      expect(r.lastError).toMatch(/indispon|não foi possível/i);
      expect(r.lastError).not.toContain(SECRET);
    });

    it("segredo ausente no Vault → invalid imediato", async () => {
      const store = new MemoryValidationStore([shopeeTask({ secretId: "nope" })]);
      await runValidationOnce(deps(store));
      expect(store.result("cred-1").status).toBe("invalid");
      expect(store.result("cred-1").lastError).toMatch(/segredo/i);
    });

    it("falha de leitura do Vault é transitória e não vaza detalhes", async () => {
      const store = new MemoryValidationStore([shopeeTask()]);
      const broken = {
        read: async () => {
          throw new Error(`pg://user:hunter2@db/${SECRET}`);
        },
      };
      await runValidationOnce(deps(store, { vault: broken }));
      const r = store.result("cred-1");
      expect(r.status).toBe("pending_validation");
      expect(r.lastError ?? "").not.toContain("hunter2");
      expect(logs.join("\n")).not.toContain("hunter2");
      expect(logs.join("\n")).not.toContain(SECRET);
    });
  });

  describe("Telegram", () => {
    it("token válido → validated", async () => {
      const store = new MemoryValidationStore([channelTask()]);
      await runValidationOnce(deps(store));
      expect(store.result("ch-1").status).toBe("validated");
    });

    it("token inválido (401) → invalid sem eco do token", async () => {
      const bad: TelegramTransport = {
        call: async () => ({ ok: false, error_code: 401, description: `Unauthorized bot${TOKEN}` }),
      };
      const store = new MemoryValidationStore([channelTask()]);
      await runValidationOnce(deps(store, { createTelegram: (t) => new TelegramClient({ token: t, transport: bad }) }));
      const r = store.result("ch-1");
      expect(r.status).toBe("invalid");
      expect(r.lastError).toMatch(/token/i);
      expect(r.lastError).not.toContain(TOKEN);
      expect(logs.join("\n")).not.toContain("canary-telegram-token");
    });

    it("grupo acessível → validated e envia a mensagem de verificação", async () => {
      const store = new MemoryValidationStore([groupTask()]);
      await runValidationOnce(deps(store));
      expect(store.result("grp-1").status).toBe("validated");
      expect(tg.getSentMessages()).toHaveLength(1);
      expect(tg.getSentMessages()[0]!.params.chat_id).toBe("-1001");
    });

    it.each([
      ["removed", (id: string) => tg.removeBotFromChat(id)],
      ["notfound", (id: string) => tg.setChatNotFound(id)],
      ["noaccess", (id: string) => tg.setChatAccess(id, false)],
    ])("grupo %s → invalid", async (_n, arrange) => {
      arrange("-1001");
      const store = new MemoryValidationStore([groupTask()]);
      await runValidationOnce(deps(store));
      const r = store.result("grp-1");
      expect(r.status).toBe("invalid");
      expect(r.lastError).toBeTruthy();
    });

    it("rate limit (429) é transitório", async () => {
      tg.setRateLimit("sendMessage", 30);
      const store = new MemoryValidationStore([groupTask()]);
      await runValidationOnce(deps(store));
      expect(store.result("grp-1").status).toBe("pending_validation");
      expect(store.result("grp-1").attempts).toBe(1);
    });
  });

  describe("timeouts", () => {
    it("dependência pendurada não trava o ciclo: respeita o timeout total da tarefa", async () => {
      const hang: TelegramTransport = { call: () => new Promise(() => {}) };
      const store = new MemoryValidationStore([channelTask()]);
      const t0 = Date.now();
      await runValidationOnce(
        deps(store, { taskTimeoutMs: 150, createTelegram: (t) => new TelegramClient({ token: t, transport: hang }) }),
      );
      expect(Date.now() - t0).toBeLessThan(1000);
      expect(store.result("ch-1").status).toBe("pending_validation");
      expect(store.result("ch-1").attempts).toBe(1);
    });

    it("leitura do Vault pendurada também é cortada", async () => {
      const store = new MemoryValidationStore([shopeeTask()]);
      const t0 = Date.now();
      await runValidationOnce(deps(store, { taskTimeoutMs: 100, vault: { read: () => new Promise(() => {}) } }));
      expect(Date.now() - t0).toBeLessThan(1000);
      expect(store.result("cred-1").status).toBe("pending_validation");
    });
  });

  describe("concorrência e lote", () => {
    it("processa várias tarefas e isola falhas entre elas", async () => {
      vault = new MemoryVault({ "sec-1": SECRET, "sec-2": TOKEN, "sec-bad": "nope" });
      const store = new MemoryValidationStore([
        shopeeTask({ id: "a" }),
        shopeeTask({ id: "b", secretId: "sec-bad" }),
        channelTask({ id: "c" }),
      ]);
      await runValidationOnce(deps(store));
      expect(store.result("a").status).toBe("validated");
      expect(store.result("b").status).toBe("invalid");
      expect(store.result("c").status).toBe("validated");
    });

    it("dois runners simultâneos não processam a mesma tarefa duas vezes", async () => {
      const store = new MemoryValidationStore([shopeeTask(), shopeeTask({ id: "cred-2" })]);
      await Promise.all([runValidationOnce(deps(store)), runValidationOnce(deps(store))]);
      expect(seenBodies).toHaveLength(2);
    });
  });

  describe("laço rápido", () => {
    it("pending_validation → validated em ≤ 15 s (simulado) e para limpo", async () => {
      const store = new MemoryValidationStore([]);
      const loop = startValidationLoop({ ...deps(store), intervalMs: 40 });
      const t0 = Date.now();
      store.add(shopeeTask());
      store.add(channelTask());
      for (;;) {
        if (store.result("cred-1")?.status === "validated" && store.result("ch-1")?.status === "validated") break;
        if (Date.now() - t0 > 15_000) throw new Error("não validou em 15 s");
        await new Promise((r) => setTimeout(r, 10));
      }
      expect(Date.now() - t0).toBeLessThan(2000);
      await loop.stop();
      const before = seenBodies.length;
      store.add(shopeeTask({ id: "later" }));
      await new Promise((r) => setTimeout(r, 150));
      expect(seenBodies.length).toBe(before);
    });

    it("erro na tick (store quebrado) é logado e o laço continua", async () => {
      const store = new MemoryValidationStore([]);
      let calls = 0;
      const flaky = {
        claimPending: async (n: number) => {
          calls += 1;
          if (calls === 1) throw new Error(`db down ${SECRET}`);
          return store.claimPending(n);
        },
        markValidated: store.markValidated.bind(store),
        markInvalid: store.markInvalid.bind(store),
        release: store.release.bind(store),
      };
      const loop = startValidationLoop({ ...deps(store), store: flaky, intervalMs: 30 });
      store.add(shopeeTask());
      const t0 = Date.now();
      while (store.result("cred-1")?.status !== "validated") {
        if (Date.now() - t0 > 3000) throw new Error("laço morreu");
        await new Promise((r) => setTimeout(r, 10));
      }
      await loop.stop();
      expect(logs.join("\n")).not.toContain(SECRET);
    });

    it("ticks não se sobrepõem", async () => {
      let inFlight = 0;
      let maxInFlight = 0;
      const store = new MemoryValidationStore([]);
      const slow = {
        ...{
          markValidated: store.markValidated.bind(store),
          markInvalid: store.markInvalid.bind(store),
          release: store.release.bind(store),
        },
        claimPending: async () => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise((r) => setTimeout(r, 80));
          inFlight -= 1;
          return [];
        },
      };
      const loop = startValidationLoop({ ...deps(store), store: slow, intervalMs: 10 });
      await new Promise((r) => setTimeout(r, 300));
      await loop.stop();
      expect(maxInFlight).toBe(1);
    });
  });

  it("nenhum log contém segredo ou token em nenhum cenário acima", async () => {
    const store = new MemoryValidationStore([shopeeTask(), channelTask(), groupTask()]);
    await runValidationOnce(deps(store));
    const all = logs.join("\n");
    expect(all).not.toContain(SECRET);
    expect(all).not.toContain("canary-telegram-token");
  });
});
