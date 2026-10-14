import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryCommissionRepository } from "@achadinhos/commission";
import type { ConversionReportPage } from "@achadinhos/commission";
import {
  COMMISSION_JOB_INTERVAL_MS,
  runCommissionCycle,
  startCommissionJob,
  type CommissionJobPorts,
} from "../src/commission-job.js";
import type { Logger } from "../src/logger.js";

const T0 = 1_760_000_000;

function logger() {
  const lines: Array<{ level: string; msg: string; ctx?: Record<string, unknown> }> = [];
  const mk = (level: string) => (msg: string, ctx?: Record<string, unknown>) => {
    lines.push(ctx ? { level, msg, ctx } : { level, msg });
  };
  const l: Logger = { debug: mk("debug"), info: mk("info"), warn: mk("warn"), error: mk("error"), addSecret: () => {} };
  return { l, lines };
}

const page = (ids: string[]): ConversionReportPage => ({
  nodes: ids.map((id) => ({
    purchaseTime: T0,
    conversionId: id,
    totalCommission: "2.5",
    subIds: ["acc", "auto", "grp", "chan", "send"],
    orders: [{ orderStatus: "PENDING" }],
  })),
  pageInfo: { hasNextPage: false, scrollId: "", limit: 50 },
});

function ports(over: Partial<CommissionJobPorts> & { repos?: Map<string, InMemoryCommissionRepository> } = {}) {
  const repos = over.repos ?? new Map<string, InMemoryCommissionRepository>();
  const calls: string[] = [];
  const p: CommissionJobPorts = {
    listAccounts: async () => ["acc-1", "acc-2"],
    sourceFor: (id) => ({
      conversionReport: async () => {
        calls.push(id);
        return page([`${id}-c1`]);
      },
    }),
    repositoryFor: (id) => {
      if (!repos.has(id)) repos.set(id, new InMemoryCommissionRepository());
      return repos.get(id)!;
    },
    ...over,
  };
  return { p, repos, calls };
}

describe("runCommissionCycle", () => {
  it("coleta cada conta com a sua fonte e o seu repositório", async () => {
    const { p, repos, calls } = ports();
    const { l } = logger();
    const r = await runCommissionCycle(p, { logger: l, now: () => T0 + 5 });
    expect(r).toMatchObject({ accounts: 2, succeeded: 2, failed: 0 });
    expect(calls).toEqual(["acc-1", "acc-2"]);
    expect(repos.get("acc-1")!.list().map((c) => c.checkoutId)).toEqual(["acc-1-c1"]);
    expect(repos.get("acc-2")!.list().map((c) => c.checkoutId)).toEqual(["acc-2-c1"]);
  });

  it("falha numa conta não impede as demais e o log só leva o nome do erro", async () => {
    const { l, lines } = logger();
    const { p } = ports({
      sourceFor: (id) => ({
        conversionReport: async () => {
          if (id === "acc-1") throw new TypeError("secret=abc123 boom");
          return page(["ok"]);
        },
      }),
    });
    const r = await runCommissionCycle(p, { logger: l, now: () => T0 });
    expect(r).toMatchObject({ succeeded: 1, failed: 1 });
    const err = lines.find((x) => x.level === "error");
    expect(err?.ctx).toMatchObject({ accountId: "acc-1", errorName: "TypeError" });
    expect(JSON.stringify(lines)).not.toContain("abc123");
  });

  it("aplica timeout total por conta", async () => {
    vi.useFakeTimers();
    try {
      const { l } = logger();
      const { p } = ports({
        listAccounts: async () => ["acc-1", "acc-2"],
        sourceFor: (id) => ({
          conversionReport: () =>
            id === "acc-1" ? new Promise<ConversionReportPage>(() => {}) : Promise.resolve(page(["z"])),
        }),
      });
      const run = runCommissionCycle(p, { logger: l, now: () => T0, accountTimeoutMs: 1000 });
      await vi.advanceTimersByTimeAsync(1001);
      expect(await run).toMatchObject({ succeeded: 1, failed: 1 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("falha ao listar contas vira erro do ciclo, sem exceção", async () => {
    const { l, lines } = logger();
    const { p } = ports({ listAccounts: async () => { throw new Error("db down"); } });
    const r = await runCommissionCycle(p, { logger: l, now: () => T0 });
    expect(r).toMatchObject({ accounts: 0, failed: 0, listFailed: true });
    expect(lines.some((x) => x.level === "error")).toBe(true);
  });
});

describe("startCommissionJob (a cada 6 h)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("o intervalo padrão é de 6 horas", () => {
    expect(COMMISSION_JOB_INTERVAL_MS).toBe(6 * 60 * 60 * 1000);
  });

  it("roda ao iniciar e depois a cada intervalo, sem sobrepor ciclos", async () => {
    const { l } = logger();
    let cycles = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { p } = ports({
      listAccounts: async () => {
        cycles += 1;
        if (cycles === 2) await gate; // 2º ciclo demora além do intervalo
        return [];
      },
    });
    const job = startCommissionJob(p, { logger: l, now: () => T0, intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(cycles).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(cycles).toBe(2);
    await vi.advanceTimersByTimeAsync(5000); // ciclo 2 preso: nenhum novo começa
    expect(cycles).toBe(2);
    release();
    await vi.advanceTimersByTimeAsync(1000);
    expect(cycles).toBe(3);
    await job.stop();
  });

  it("stop cancela o agendamento", async () => {
    const { l } = logger();
    let cycles = 0;
    const { p } = ports({ listAccounts: async () => { cycles += 1; return []; } });
    const job = startCommissionJob(p, { logger: l, now: () => T0, intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(0);
    await job.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(cycles).toBe(1);
  });
});
