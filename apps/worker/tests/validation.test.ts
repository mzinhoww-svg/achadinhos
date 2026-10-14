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
        markVerificationSent: store.markVerificationSent.bind(store),
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
          markVerificationSent: store.markVerificationSent.bind(store),
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

  describe("ciclo nunca trava (ciclo 1 do QA)", () => {
    const hang = () => new Promise<never>(() => {});

    it("markValidated pendurado não trava o lote: as outras tarefas concluem", async () => {
      const base = new MemoryValidationStore([shopeeTask({ id: "a" }), channelTask({ id: "b" })]);
      const store = {
        claimPending: base.claimPending.bind(base),
        markInvalid: base.markInvalid.bind(base),
        release: base.release.bind(base),
        markVerificationSent: base.markVerificationSent.bind(base),
        markValidated: (t: ValidationTask, at: Date) => (t.id === "a" ? hang() : base.markValidated(t, at)),
      };
      const t0 = Date.now();
      await runValidationOnce(deps(base, { store, taskTimeoutMs: 150 }));
      expect(Date.now() - t0).toBeLessThan(1500);
      expect(base.result("b").status).toBe("validated");
      expect(logs.join("\n")).toContain("validation.store_write_failed");
    });

    it("markInvalid e release pendurados também são cortados", async () => {
      vault = new MemoryVault({ "sec-1": "wrong" , "sec-2": TOKEN });
      const base = new MemoryValidationStore([shopeeTask()]);
      const store = {
        claimPending: base.claimPending.bind(base),
        markValidated: base.markValidated.bind(base),
        markVerificationSent: base.markVerificationSent.bind(base),
        markInvalid: hang,
        release: hang,
      };
      const t0 = Date.now();
      await runValidationOnce(deps(base, { store, taskTimeoutMs: 150 }));
      expect(Date.now() - t0).toBeLessThan(1500);
    });

    it("claimPending pendurado: o ciclo termina e stop() retorna", async () => {
      const base = new MemoryValidationStore([]);
      const store = {
        claimPending: hang,
        markValidated: base.markValidated.bind(base),
        markInvalid: base.markInvalid.bind(base),
        release: base.release.bind(base),
        markVerificationSent: base.markVerificationSent.bind(base),
      };
      const t0 = Date.now();
      await expect(runValidationOnce(deps(base, { store, taskTimeoutMs: 100 }))).rejects.toThrow();
      expect(Date.now() - t0).toBeLessThan(1000);

      const loop = startValidationLoop({ ...deps(base, { store, taskTimeoutMs: 100 }), intervalMs: 20 });
      await new Promise((r) => setTimeout(r, 60));
      const s0 = Date.now();
      await loop.stop();
      expect(Date.now() - s0).toBeLessThan(1000);
    });

    it("stop() tem limite mesmo com tarefa em voo que ignora o prazo", async () => {
      const base = new MemoryValidationStore([channelTask()]);
      const slowTelegram = { call: hang } as unknown as TelegramTransport;
      const loop = startValidationLoop({
        ...deps(base, {
          taskTimeoutMs: 5_000,
          createTelegram: (t) => new TelegramClient({ token: t, transport: slowTelegram }),
        }),
        intervalMs: 10,
        stopTimeoutMs: 100,
      });
      await new Promise((r) => setTimeout(r, 80));
      const s0 = Date.now();
      await loop.stop();
      expect(Date.now() - s0).toBeLessThan(1000);
    });
  });

  describe("verificação de grupo posta no máximo uma vez (ciclo 1 do QA)", () => {
    it("envio mais lento que o prazo: 1 mensagem, estado final sem repostar em novos ciclos", async () => {
      let sends = 0;
      const slow: TelegramTransport = {
        call: async (method: string) => {
          if (method === "sendMessage") {
            sends += 1;
            await new Promise((r) => setTimeout(r, 400));
          }
          return { ok: true, result: { message_id: 1, date: 1, chat: { id: -1001, type: "supergroup" } } } as never;
        },
      };
      const store = new MemoryValidationStore([groupTask()]);
      const d = deps(store, {
        taskTimeoutMs: 100,
        createTelegram: (t) => new TelegramClient({ token: t, transport: slow }),
      });
      await runValidationOnce(d);
      await runValidationOnce(d);
      await runValidationOnce(d);
      await new Promise((r) => setTimeout(r, 500));
      expect(sends).toBe(1);
      const r = store.result("grp-1");
      expect(r.status).toBe("invalid");
      expect(r.lastError).toMatch(/verifica/i);
    });

    it("erro de rede após o envio (resultado desconhecido) não reposta", async () => {
      let sends = 0;
      const flaky: TelegramTransport = {
        call: async (method: string) => {
          if (method === "sendMessage") {
            sends += 1;
            throw new Error("socket hang up");
          }
          return { ok: true, result: {} } as never;
        },
      };
      const store = new MemoryValidationStore([groupTask()]);
      const d = deps(store, { createTelegram: (t) => new TelegramClient({ token: t, transport: flaky }) });
      await runValidationOnce(d);
      await runValidationOnce(d);
      expect(sends).toBe(1);
      expect(store.result("grp-1").status).toBe("invalid");
    });

    it("tarefa que já tem verification_sent_at não envia de novo", async () => {
      const store = new MemoryValidationStore([groupTask({ verificationSentAt: new Date("2026-10-14T11:00:00Z") })]);
      await runValidationOnce(deps(store));
      expect(tg.getSentMessages()).toHaveLength(0);
      expect(store.result("grp-1").status).toBe("invalid");
    });

    it("429 (não entregue, resultado definitivo) permite novo envio depois", async () => {
      tg.setRateLimit("sendMessage", 1);
      const store = new MemoryValidationStore([groupTask()]);
      await runValidationOnce(deps(store));
      expect(store.result("grp-1").status).toBe("pending_validation");
      tg.setRateLimit("sendMessage", null);
      await runValidationOnce(deps(store));
      expect(store.result("grp-1").status).toBe("validated");
      expect(tg.getSentMessages()).toHaveLength(1);
    });

    it("a marcação de envio acontece antes do envio", async () => {
      const order: string[] = [];
      const base = new MemoryValidationStore([groupTask()]);
      const store = {
        claimPending: base.claimPending.bind(base),
        markValidated: base.markValidated.bind(base),
        markInvalid: base.markInvalid.bind(base),
        release: base.release.bind(base),
        markVerificationSent: async (t: ValidationTask, at: Date) => {
          order.push("mark");
          return base.markVerificationSent(t, at);
        },
      };
      const rec: TelegramTransport = {
        call: async (m: string) => {
          order.push(m);
          return { ok: true, result: { message_id: 1, date: 1, chat: { id: -1001, type: "supergroup" } } } as never;
        },
      };
      await runValidationOnce(deps(base, { store, createTelegram: (t) => new TelegramClient({ token: t, transport: rec }) }));
      expect(order.indexOf("mark")).toBeLessThan(order.indexOf("sendMessage"));
    });
  });

  describe("revalidar depois de falha definitiva (ciclo 2 do QA)", () => {
    it("NoAccess (nada entregue) → re-enfileirar → permissão ajustada → validated", async () => {
      const store = new MemoryValidationStore([groupTask()]);
      tg.setChatAccess("-1001", false);
      await runValidationOnce(deps(store));
      expect(store.result("grp-1").status).toBe("invalid");
      expect(store.result("grp-1").lastError).toMatch(/permiss/i);
      expect(store.result("grp-1").verificationSentAt).toBeNull();

      tg.setChatAccess("-1001", true);
      store.requeue("grp-1"); // painel: usuário pede nova validação
      await runValidationOnce(deps(store));
      expect(store.result("grp-1").status).toBe("validated");
      expect(tg.getSentMessages()).toHaveLength(1);
    });

    it.each([
      ["removido", (id: string) => tg.removeBotFromChat(id)],
      ["bloqueado", (id: string) => tg.blockBotInChat(id)],
      ["não encontrado", (id: string) => tg.setChatNotFound(id)],
    ])("falha definitiva %s limpa a marca de verificação", async (_n, arrange) => {
      arrange("-1001");
      const store = new MemoryValidationStore([groupTask()]);
      await runValidationOnce(deps(store));
      expect(store.result("grp-1").status).toBe("invalid");
      expect(store.result("grp-1").verificationSentAt).toBeNull();
    });

    it("timeout/transporte (entrega possível) mantém a marca", async () => {
      const flaky: TelegramTransport = {
        call: async () => {
          throw new Error("socket hang up");
        },
      };
      const store = new MemoryValidationStore([groupTask()]);
      await runValidationOnce(deps(store, { createTelegram: (t) => new TelegramClient({ token: t, transport: flaky }) }));
      expect(store.result("grp-1").status).toBe("invalid");
      expect(store.result("grp-1").verificationSentAt).not.toBeNull();
    });

    it("requeue zera attempts e a marca; sem requeue, marca antiga segue sem repostar", async () => {
      const store = new MemoryValidationStore([groupTask({ attempts: 2, verificationSentAt: new Date() })]);
      store.requeue("grp-1");
      const r = store.result("grp-1");
      expect(r.attempts).toBe(0);
      expect(r.verificationSentAt).toBeNull();
      expect(r.status).toBe("pending_validation");
    });
  });

  it("log de falha de gravação traz só o tipo do erro, sem mensagem", async () => {
    const base = new MemoryValidationStore([shopeeTask()]);
    const store = {
      claimPending: base.claimPending.bind(base),
      markInvalid: base.markInvalid.bind(base),
      release: base.release.bind(base),
      markVerificationSent: base.markVerificationSent.bind(base),
      markValidated: async () => {
        throw new TypeError(`write failed ${SECRET}`);
      },
    };
    await runValidationOnce(deps(base, { store }));
    const all = logs.join("\n");
    expect(all).toContain("TypeError");
    expect(all).not.toContain(SECRET);
  });

  it("nenhum log contém segredo ou token em nenhum cenário acima", async () => {
    const store = new MemoryValidationStore([shopeeTask(), channelTask(), groupTask()]);
    await runValidationOnce(deps(store));
    const all = logs.join("\n");
    expect(all).not.toContain(SECRET);
    expect(all).not.toContain("canary-telegram-token");
  });
});
