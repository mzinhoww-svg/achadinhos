import { describe, expect, it, vi } from "vitest";
import { startWorker, type BuildDeps } from "../src/main.js";

const env = { DATABASE_URL: "postgres://worker:Sup3rS3nhaDB@db.example.com:5432/postgres" };
const okDeps: BuildDeps = async () => ({
  now: () => new Date(),
  scheduler: { runTick: async () => ({ considered: 0, enqueued: 0, skipped: 0, advanced: 0, initialized: 0, contended: 0, errors: 0 }) },
  queue: { listChannels: async () => [], claim: async () => null },
  executor: { run: async () => ({ status: "sent", finishRecorded: true }) },
  alerts: { shopeeCredentialFailed: async () => {}, telegramBotLostAccess: async () => {}, workerNoHeartbeat: async () => {} },
});

describe("startWorker", () => {
  it("config inválida: falha fechada, não constrói adaptadores nem inicia laços", async () => {
    const build = vi.fn(okDeps);
    const lines: string[] = [];
    const r = await startWorker({ env: {}, buildDeps: build, sink: (l) => lines.push(l) });
    expect(r.ok).toBe(false);
    expect(build).not.toHaveBeenCalled();
    expect(lines.join("\n")).toContain("DATABASE_URL");
  });

  it("falha ao montar adaptadores: log sem a senha do banco e ok=false", async () => {
    const lines: string[] = [];
    const r = await startWorker({
      env,
      buildDeps: async () => { throw new Error("connect postgres://worker:Sup3rS3nhaDB@db.example.com falhou"); },
      sink: (l) => lines.push(l),
    });
    expect(r.ok).toBe(false);
    expect(lines.join("\n")).not.toContain("Sup3rS3nhaDB");
  });

  it("sobe, inicia o runtime e encerra limpo", async () => {
    const lines: string[] = [];
    const r = await startWorker({ env: { ...env, EXECUTOR_POLL_MS: "1000" }, buildDeps: okDeps, sink: (l) => lines.push(l) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const stop = await r.runtime.stop();
    expect(stop.clean).toBe(true);
    expect(lines.join("\n")).not.toContain("Sup3rS3nhaDB");
  });

  it("sem adaptador de produção, o buildDeps padrão falha com mensagem clara", async () => {
    const { defaultBuildDeps } = await import("../src/main.js");
    await expect(defaultBuildDeps({} as never, {} as never)).rejects.toThrow(/adaptador/i);
  });
});
