import { describe, expect, it } from "vitest";
import * as D from "../index.js";

describe("blocker1 estimate ceil", () => {
  it("non-divisible window 25", () => {
    expect(D.estimatePostsPerDay({ groups: 1, windowStart: "08:00", windowEnd: "20:10", frequencyMin: 30 as any }).raw).toBe(25);
  });
});

describe("blocker3 invalid date", () => {
  it("returns false", () => {
    expect(D.isWithinWindow(new Date(NaN), { windowStart: "20:00", windowEnd: "23:00", days: [1], timeZone: "America/Cuiaba" } as any)).toBe(false);
  });
});

describe("blocker4 equal window", () => {
  it("estimate 0 and within false", () => {
    expect(D.estimatePostsPerDay({ groups: 1, windowStart: "08:00", windowEnd: "08:00", frequencyMin: 30 as any }).raw).toBe(0);
    expect(D.isWithinWindow(new Date("2026-10-13T12:00:00-04:00"), { windowStart: "08:00", windowEnd: "08:00", days: [2], timeZone: "America/Cuiaba" } as any)).toBe(false);
  });
});

describe("blocker2 advance uses now", () => {
  it("skips missed slots", () => {
    // current 08:00, now 16:00, next must be >= 16:00, not 08:30
    const group = { next_run_at: new Date("2026-10-13T08:00:00-04:00") };
    const cfg = { windowStart: "08:00", windowEnd: "20:00", frequencyMin: 30, days: [2], timeZone: "America/Cuiaba" };
    const now = new Date("2026-10-13T16:00:00-04:00");
    const next = D.advanceNextRunAt(group as any, cfg as any, now);
    expect(next.getTime()).toBeGreaterThanOrEqual(now.getTime());
    expect(D.hasMissedSlot(group as any, now)).toBe(true);
  });
});

describe("blocker3 getZonedParts", () => {
  it("throws on invalid date", () => {
    expect(() => D.getZonedParts(new Date(NaN), "America/Cuiaba")).toThrow();
  });
});

describe("blocker4 zod equal", () => {
  it("rejects equal window", () => {
    const r = D.safeValidateAutomation({ days: [2], windowStart: "08:00", windowEnd: "08:00", frequencyMin: 30 });
    expect(r.success).toBe(false);
  });
});
