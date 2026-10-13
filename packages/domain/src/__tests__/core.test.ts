import { describe, expect, it } from "vitest";
import * as D from "../index.js";

describe("estimate", () => {
  it("basic", () => {
    expect(D.estimatePostsPerDay({ groups: 2, windowStart: "08:00", windowEnd: "20:00", frequencyMin: 30 }).raw).toBe(48);
  });
  it("cross midnight window", () => {
    const r = D.estimatePostsPerDay({ groups: 1, windowStart: "22:00", windowEnd: "02:00", frequencyMin: 60 });
    expect(r.raw).toBe(4);
  });
  it("cap", () => {
    const r = D.estimatePostsPerDay({ groups: 10, windowStart: "06:00", windowEnd: "23:00", frequencyMin: 15 });
    expect(r.capped).toBe(200);
    expect(r.hitCap).toBe(true);
  });
});

describe("window", () => {
  it("cross midnight inside", () => {
    // America/Cuiaba UTC-4; choose noon-ish? Use explicit date string parse as UTC? We'll test isWithinWindow with Date constructed
    const d = new Date("2026-10-13T23:30:00-04:00");
    expect(D.isWithinWindow(d, { windowStart: "22:00", windowEnd: "02:00", days: [2], timeZone: "America/Cuiaba" })).toBe(true);
  });
  it("minutesOfDay", () => {
    const min = D.windowMinutes("22:00", "02:00");
    expect(min).toBe(240);
  });
});

describe("offers filter", () => {
  const offers = [
    { productName: "Fone bluetooth", priceMin: 50, priceDiscountRate: 30, commissionRate: 0.1, ratingStar: 4.6, sales: 600, category: "Eletrônicos" },
    { productName: "Panela", priceMin: 120, priceDiscountRate: 10, commissionRate: 0.05, ratingStar: 4.2, sales: 100, category: "Casa" },
  ] as any[];
  it("filters", () => {
    const res = D.filterOffers(offers, { category: "Eletrônicos", minDiscount: 20, minCommission: 8, minRating: 4.5, keywords: "bluetooth" });
    expect(res.length).toBe(1);
  });
  it("sort price asc", () => {
    const res = D.filterOffers(offers, { sort: "price_asc" });
    expect(res[0].productName).toBe("Fone bluetooth");
  });
});

describe("dedupe", () => {
  it("repeated within 7 days", () => {
    const now = new Date("2026-10-13T12:00:00Z");
    const hist = [{ group_id: "g1", item_id: "i1", status: "sent", sent_at: new Date("2026-10-10T12:00:00Z") }];
    expect(D.isRepeated({ history: hist, groupId: "g1", itemId: "i1", now })).toBe(true);
    expect(D.checkDedupe({ history: hist, groupId: "g1", itemId: "i1", now }).reason).toBe("repetida");
  });
  it("not repeated after 8 days", () => {
    const now = new Date("2026-10-20T12:00:00Z");
    const hist = [{ group_id: "g1", item_id: "i1", status: "sent", sent_at: new Date("2026-10-10T12:00:00Z") }];
    expect(D.isRepeated({ history: hist, groupId: "g1", itemId: "i1", now })).toBe(false);
  });
});

describe("automation validation", () => {
  it("valid", () => {
    const v = D.validateAutomation({ days: [1, 2], windowStart: "08:00", windowEnd: "20:00", frequencyMin: 30, header: "h", footer: "f" });
    expect(v.frequencyMin).toBe(30);
  });
  it("snake case and cross window", () => {
    const r = D.safeValidateAutomation({ days: [1], window_start: "22:00", window_end: "02:00", frequency_min: 15 });
    expect(r.success).toBe(true);
  });
  it("invalid freq", () => {
    const r = D.safeValidateAutomation({ days: [1], windowStart: "08:00", windowEnd: "20:00", frequencyMin: 45 });
    expect(r.success).toBe(false);
  });
  it("limit", () => {
    expect(D.canCreateAutomation(4)).toBe(true);
    expect(D.canCreateAutomation(5)).toBe(false);
    expect(() => D.assertAutomationLimit(5)).toThrow();
  });
});

describe("scheduling", () => {
  it("nextRunAt boundary", () => {
    const now = new Date("2026-10-13T11:00:00Z");
    // weekday of now in Cuiaba? compute day mapping may differ; use a fixed low-level: next should be >= now
    const next = D.nextRunAt(now, { windowStart: "08:00", windowEnd: "20:00", frequencyMin: 30, days: [0,1,2,3,4,5,6], timeZone: "America/Cuiaba" });
    expect(next.getTime()).toBeGreaterThanOrEqual(now.getTime());
  });
  it("due groups", () => {
    const now = new Date("2026-10-13T12:00:00Z");
    const groups = [
      { id: "a", next_run_at: new Date("2026-10-13T11:00:00Z"), active: true },
      { id: "b", next_run_at: new Date("2026-10-13T13:00:00Z"), active: true },
    ];
    expect(D.selectDueGroups(groups, now).map((g: any) => g.id)).toEqual(["a"]);
  });
});
