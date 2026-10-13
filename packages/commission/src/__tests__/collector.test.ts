import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  InMemoryCommissionRepository,
  CommissionCollector,
  createCommissionCollector,
  collectCommissions,
} from "../index.js";
import type { ConversionReportNode, ConversionReportPage } from "../index.js";

const fixtureNodes: ConversionReportNode[] = [
  {
    purchaseTime: 1700000000,
    clickTime: 1699999000,
    conversionId: "checkout-1",
    totalCommission: 3.5,
    status: "COMPLETED",
    subIds: ["conta-1", "auto-1", "grupo-a", "telegram", "send-1"],
    orders: [],
  },
  {
    purchaseTime: 1700001000,
    clickTime: 1699999100,
    conversionId: "checkout-2",
    totalCommission: 2.0,
    status: "COMPLETED",
    subIds: ["conta-1", "auto-1", "grupo-a", "telegram", "send-2"],
    orders: [],
  },
  {
    purchaseTime: 1700002000,
    clickTime: 1699999200,
    conversionId: "checkout-3",
    totalCommission: 1.2,
    status: "PENDING",
    subIds: ["conta-1", "auto-2", "grupo-b", "telegram", "send-3"],
    orders: [],
  },
];

function makeSource(pages: ConversionReportPage[]) {
  let index = 0;
  return {
    conversionReport: async () => {
      const page = pages[index] ?? pages[pages.length - 1]!;
      index += 1;
      return page;
    },
  };
}

describe("CommissionCollector", () => {
  it("collects all conversions and aggregates by group on first run", async () => {
    const repo = new InMemoryCommissionRepository();
    const page: ConversionReportPage = {
      nodes: fixtureNodes,
      pageInfo: { hasNextPage: false, scrollId: "", limit: 50 },
    };
    const source = makeSource([page]);
    const collector = new CommissionCollector(source, repo);
    const result = await collector.collect();
    expect(result.inserted).toBe(3);
    expect(result.total).toBe(3);
    expect(repo.list()).toHaveLength(3);

    const byGroup = repo.aggregateByGroup();
    expect(byGroup["grupo-a"]).toBeCloseTo(5.5);
    expect(byGroup["grupo-b"]).toBeCloseTo(1.2);
  });

  it("re-running twice does not duplicate", async () => {
    const repo = new InMemoryCommissionRepository();
    const page: ConversionReportPage = {
      nodes: fixtureNodes,
      pageInfo: { hasNextPage: false, scrollId: "", limit: 50 },
    };
    // Source replays the same data on every call.
    const source = { conversionReport: async () => page };
    const collector = createCommissionCollector(source, repo);
    await collector.collect();
    await collector.collect();
    await collectCommissions(source, repo);
    expect(repo.list()).toHaveLength(3);
    const byGroup = repo.aggregateByGroup();
    expect(byGroup["grupo-a"]).toBeCloseTo(5.5);
    expect(byGroup["grupo-b"]).toBeCloseTo(1.2);
  });

  it("records a status change without duplicating the checkout", async () => {
    const repo = new InMemoryCommissionRepository();
    const first: ConversionReportPage = {
      nodes: [fixtureNodes[0]!],
      pageInfo: { hasNextPage: false, scrollId: "", limit: 50 },
    };
    const second: ConversionReportPage = {
      nodes: [{ ...fixtureNodes[0]!, status: "APPROVED" } as ConversionReportNode],
      pageInfo: { hasNextPage: false, scrollId: "", limit: 50 },
    };
    const source = makeSource([first, second]);
    const collector = new CommissionCollector(source, repo);
    await collector.collect();
    await collector.collect();
    expect(repo.list()).toHaveLength(1);
    expect(repo.getByCheckoutId("checkout-1")?.status).toBe("APPROVED");
    const events = repo.statusHistory();
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[events.length - 1]!.to).toBe("APPROVED");
  });

  it("paginates until hasNextPage is false", async () => {
    const repo = new InMemoryCommissionRepository();
    const page1: ConversionReportPage = {
      nodes: [fixtureNodes[0]!, fixtureNodes[1]!],
      pageInfo: { hasNextPage: true, scrollId: "next-1", limit: 2 },
    };
    const page2: ConversionReportPage = {
      nodes: [fixtureNodes[2]!],
      pageInfo: { hasNextPage: false, scrollId: "done", limit: 2 },
    };
    const calls: string[] = [];
    const source = {
      conversionReport: async (params?: { scrollId?: string }) => {
        calls.push(params?.scrollId ?? "");
        return params?.scrollId ? page2 : page1;
      },
    };
    const collector = new CommissionCollector(source, repo, { pageSize: 2 });
    const result = await collector.collect();
    expect(result.pages).toBe(2);
    expect(result.inserted).toBe(3);
    expect(calls).toContain("next-1");
  });

  it("createCommissionCollector supports object form and collectCommissions", async () => {
    const repo = new InMemoryCommissionRepository();
    const page: ConversionReportPage = {
      nodes: fixtureNodes,
      pageInfo: { hasNextPage: false, scrollId: "", limit: 50 },
    };
    const source = { conversionReport: async () => page };
    const collector = createCommissionCollector({ source, repository: repo });
    const r = await collector.collect();
    expect(r.inserted).toBe(3);
    expect(repo.list().length).toBe(3);
  });
});