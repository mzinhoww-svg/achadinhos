import { describe, expect, it, vi } from "vitest";
import { createWorkerRuntime, checkWorkerStalled, type RuntimeDeps } from "../src/runtime.js";
import type { ClaimedSend, RunOutcome } from "../src/executor.js";

const claim = (id: string, channelId = "c1"): ClaimedSend => ({
  sendId: id, accountId: "acc", automationId: "au", groupId: "g", groupSubId: "g1", channelId,
  offerId: "o", chatId: -1001, affiliateHandle: "h",
  offer: { title: "t", imageUrl: "https://x/i", productUrl: "https://shopee.com.br/p", priceCurrent: 1, priceOld: 2, discountPct: 50 },
});
const tickResult = { considered: 0, enqueued: 0, skipped: 0, advanced: 0, initialized: 0, contended: 0, errors: 0 };
const sent: RunOutcome = { status: "sent", finishRecorded: true };

function setup(over: Partial<RuntimeDeps> = {}) {
  let nowMs = Date.parse("2026-10-14T15:00:00Z");
  const lines: string[] = [];
  const deactivate = vi.fn(async (_groupId: string, _reason: string) => undefined);
  const alerts = {
    shopeeCredentialFailed: vi.fn(async () => undefined),
    telegramBotLostAccess: vi.fn(async () => undefined),
    workerNoHeartbeat: vi.fn(async () => undefined),
  };
  const deps: RuntimeDeps = {
    config: { tickIntervalMs: 60_000, executorPollMs: 5_000, stallAlertMs: 600_000, shutdownGraceMs: 200 },
    log: { debug() {}, info: (m, c) => lines.push(JSON.stringify([m, c])), warn: (m, c) => lines.push(JSON.stringify([m, c])), error: (m, c) => lines.push(JSON.stringify([m, c])), addSecret() {} },
    now: () => new Date(nowMs),
    scheduler: { runTick: async () => tickResult },
    queue: { listChannels: async () => ["c1"], claim: async () => null },
    executor: { run: async () => sent },
    alerts,
    groups: { deactivate: deactivate },
    ...over,
  };
  return { deps, alerts, deactivate, lines, advance: (ms: number) => { nowMs += ms; } };
}

describe("tick do agendador", () => {
  it("roda o agendador e bate o heartbeat; erro não lança nem bate", async () => {
    const s = setup();
    const rt = createWorkerRuntime(s.deps);
    await rt.tickOnce();
    expect(rt.heartbeat().lastBeatAt).toBe(s.deps.now().getTime());

    const s2 = setup({ scheduler: { runTick: async () => { throw new Error("db caiu SEGREDO"); } } });
    const rt2 = createWorkerRuntime(s2.deps);
    await expect(rt2.tickOnce()).resolves.toBeUndefined();
    expect(rt2.heartbeat().lastBeatAt).toBeNull();
    expect(s2.lines.join("")).not.toContain("SEGREDO");
  });

  it("grava o batimento na store externa quando existe, e falha de gravação não derruba", async () => {
    const write = vi.fn(async () => { throw new Error("x"); });
    const s = setup({ heartbeatStore: { write, read: async () => null } });
    const rt = createWorkerRuntime(s.deps);
    await rt.tickOnce();
    expect(write).toHaveBeenCalledOnce();
  });
});

describe("laço do executor", () => {
  it("faz claim por canal e executa; sem claim não chama o executor", async () => {
    const run = vi.fn(async () => sent);
    const claimFn = vi.fn(async (ch: string) => (ch === "c2" ? claim("s2", "c2") : null));
    const s = setup({ queue: { listChannels: async () => ["c1", "c2"], claim: claimFn }, executor: { run } });
    await createWorkerRuntime(s.deps).executorOnce();
    expect(claimFn).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ sendId: "s2" }));
  });

  it("falha em um canal (claim ou execução) não impede os outros", async () => {
    const run = vi.fn(async (c: ClaimedSend): Promise<RunOutcome> => { if (c.sendId === "boom") throw new Error("x"); return sent; });
    const claimFn = async (ch: string) => (ch === "a" ? Promise.reject(new Error("pg")) : claim(ch === "b" ? "boom" : "ok", ch));
    const s = setup({ queue: { listChannels: async () => ["a", "b", "c"], claim: claimFn }, executor: { run } });
    await expect(createWorkerRuntime(s.deps).executorOnce()).resolves.toBeUndefined();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("bot sem acesso/removido/bloqueado/chat não encontrado => alerta Telegram só com ids", async () => {
    for (const reason of ["telegram_sem_acesso", "telegram_bot_removido", "telegram_bot_bloqueado", "telegram_chat_nao_encontrado"]) {
      const s = setup({ queue: { listChannels: async () => ["c1"], claim: async () => claim("s1") }, executor: { run: async () => ({ status: "failed", reason, finishRecorded: true }) } });
      await createWorkerRuntime(s.deps).executorOnce();
      expect(s.alerts.telegramBotLostAccess).toHaveBeenCalledWith({ accountId: "acc", group: "g", reason });
    }
  });

  it("erro de acesso do bot desativa o grupo (com motivo fixo) antes do alerta", async () => {
    for (const reason of ["telegram_sem_acesso", "telegram_bot_removido", "telegram_bot_bloqueado", "telegram_chat_nao_encontrado"]) {
      const order: string[] = [];
      const s = setup({ queue: { listChannels: async () => ["c1"], claim: async () => claim("s1") }, executor: { run: async () => ({ status: "failed", reason, finishRecorded: true }) } });
      s.deactivate.mockImplementation(async () => { order.push("deactivate"); });
      s.alerts.telegramBotLostAccess.mockImplementation(async () => { order.push("alert"); });
      await createWorkerRuntime(s.deps).executorOnce();
      expect(s.deactivate).toHaveBeenCalledWith("g", reason);
      expect(order).toEqual(["deactivate", "alert"]);
    }
  });

  it("falha ao desativar o grupo não impede o alerta", async () => {
    const s = setup({ queue: { listChannels: async () => ["c1"], claim: async () => claim("s1") }, executor: { run: async () => ({ status: "failed", reason: "telegram_bot_removido", finishRecorded: true }) } });
    s.deactivate.mockRejectedValueOnce(new Error("db"));
    await createWorkerRuntime(s.deps).executorOnce();
    expect(s.alerts.telegramBotLostAccess).toHaveBeenCalledOnce();
  });

  it("falhas que não são de acesso (timeout, rate limit) não desativam o grupo", async () => {
    for (const reason of ["timeout_shopee", "telegram_rate_limit", "telegram_timeout_resultado_desconhecido"]) {
      const s = setup({ queue: { listChannels: async () => ["c1"], claim: async () => claim("s1") }, executor: { run: async () => ({ status: "failed", reason, finishRecorded: true }) } });
      await createWorkerRuntime(s.deps).executorOnce();
      expect(s.deactivate).not.toHaveBeenCalled();
    }
  });

  it("assinatura Shopee inválida => alerta de credencial", async () => {
    const s = setup({ queue: { listChannels: async () => ["c1"], claim: async () => claim("s1") }, executor: { run: async () => ({ status: "failed", reason: "shopee_assinatura_invalida", finishRecorded: true }) } });
    await createWorkerRuntime(s.deps).executorOnce();
    expect(s.alerts.shopeeCredentialFailed).toHaveBeenCalledWith({ accountId: "acc", reason: "shopee_assinatura_invalida" });
  });

  it("falha comum (timeout) não alerta", async () => {
    const s = setup({ queue: { listChannels: async () => ["c1"], claim: async () => claim("s1") }, executor: { run: async () => ({ status: "failed", reason: "timeout_shopee", finishRecorded: true }) } });
    await createWorkerRuntime(s.deps).executorOnce();
    expect(s.alerts.telegramBotLostAccess).not.toHaveBeenCalled();
    expect(s.alerts.shopeeCredentialFailed).not.toHaveBeenCalled();
  });

  it("alerta que falha ao enviar não derruba o laço", async () => {
    const s = setup({ queue: { listChannels: async () => ["c1"], claim: async () => claim("s1") }, executor: { run: async () => ({ status: "failed", reason: "telegram_sem_acesso", finishRecorded: true }) } });
    s.alerts.telegramBotLostAccess.mockRejectedValueOnce(new Error("smtp"));
    await expect(createWorkerRuntime(s.deps).executorOnce()).resolves.toBeUndefined();
  });
});

describe("validação (porta do #28)", () => {
  it("sinais da validação viram alertas", async () => {
    const s = setup({ validation: { runOnce: async () => [
      { kind: "shopee_credential_invalid", accountId: "acc" },
      { kind: "telegram_no_access", accountId: "acc", group: "g9" },
    ] } });
    await createWorkerRuntime(s.deps).validateOnce();
    expect(s.alerts.shopeeCredentialFailed).toHaveBeenCalledWith({ accountId: "acc", reason: "credencial_invalida" });
    expect(s.alerts.telegramBotLostAccess).toHaveBeenCalledWith({ accountId: "acc", group: "g9", reason: "sem_acesso" });
  });
});

describe("worker parado > 10 min", () => {
  it("alerta quando o último batimento passou do limite; não alerta antes", async () => {
    const s = setup();
    const rt = createWorkerRuntime(s.deps);
    await rt.tickOnce();
    s.advance(599_000);
    await rt.checkStalled();
    expect(s.alerts.workerNoHeartbeat).not.toHaveBeenCalled();
    s.advance(2_000);
    await rt.checkStalled();
    expect(s.alerts.workerNoHeartbeat).toHaveBeenCalledOnce();
  });

  it("monitor externo: checkWorkerStalled lê o batimento persistido", async () => {
    const alerts = { workerNoHeartbeat: vi.fn(async () => undefined) };
    const now = new Date("2026-10-14T15:11:00Z");
    expect(await checkWorkerStalled({ read: async () => new Date("2026-10-14T15:00:00Z") }, alerts, now, 600_000)).toBe(true);
    expect(await checkWorkerStalled({ read: async () => new Date("2026-10-14T15:05:00Z") }, alerts, now, 600_000)).toBe(false);
    expect(await checkWorkerStalled({ read: async () => null }, alerts, now, 600_000)).toBe(true); // nunca bateu
    expect(alerts.workerNoHeartbeat).toHaveBeenCalledTimes(2);
  });
});

describe("start/stop", () => {
  it("agenda os laços, não sobrepõe execuções e stop espera o que está em voo", async () => {
    let inFlight = 0, maxInFlight = 0, finished = 0;
    const slow = async () => { inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); await new Promise((r) => setTimeout(r, 40)); inFlight--; finished++; return tickResult; };
    const s = setup({
      config: { tickIntervalMs: 5, executorPollMs: 5, stallAlertMs: 600_000, shutdownGraceMs: 500 },
      scheduler: { runTick: slow },
    });
    const rt = createWorkerRuntime(s.deps);
    rt.start();
    await new Promise((r) => setTimeout(r, 120));
    const res = await rt.stop();
    expect(maxInFlight).toBe(1);
    expect(res.clean).toBe(true);
    expect(inFlight).toBe(0);
    const after = finished;
    await new Promise((r) => setTimeout(r, 60));
    expect(finished).toBe(after); // nada novo depois do stop
  });

  it("stop devolve clean=false quando um envio não termina dentro da graça", async () => {
    const s = setup({
      config: { tickIntervalMs: 60_000, executorPollMs: 5, stallAlertMs: 600_000, shutdownGraceMs: 50 },
      queue: { listChannels: async () => ["c1"], claim: async () => claim("s1") },
      executor: { run: () => new Promise<RunOutcome>(() => {}) },
    });
    const rt = createWorkerRuntime(s.deps);
    rt.start();
    await new Promise((r) => setTimeout(r, 30));
    const t0 = Date.now();
    const res = await rt.stop();
    expect(res.clean).toBe(false);
    expect(Date.now() - t0).toBeLessThan(500);
  });

  it("start duas vezes não duplica laços", async () => {
    const runTick = vi.fn(async () => tickResult);
    const s = setup({ config: { tickIntervalMs: 1_000, executorPollMs: 1_000, stallAlertMs: 600_000, shutdownGraceMs: 100 }, scheduler: { runTick } });
    const rt = createWorkerRuntime(s.deps);
    rt.start();
    rt.start();
    await new Promise((r) => setTimeout(r, 30));
    await rt.stop();
    expect(runTick).toHaveBeenCalledTimes(1);
  });
});
