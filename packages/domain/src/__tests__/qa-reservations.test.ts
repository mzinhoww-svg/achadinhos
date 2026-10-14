import { describe, expect, it } from "vitest";
import * as D from "../index.js";

describe("QA reservation 1: invalid timezone rejected by validator", () => {
  it("safeValidateAutomation rejects tz Foo/Bar", () => {
    const r = D.safeValidateAutomation({
      days: [2],
      windowStart: "08:00",
      windowEnd: "20:00",
      frequencyMin: 30,
      timeZone: "Foo/Bar",
    } as any);
    expect(r.success).toBe(false);
  });

  it("safeValidateAutomation rejects tz Foo/Bar via timezone alias", () => {
    const r = D.safeValidateAutomation({
      days: [2],
      windowStart: "08:00",
      windowEnd: "20:00",
      frequencyMin: 30,
      timezone: "Foo/Bar",
    } as any);
    expect(r.success).toBe(false);
  });

  it("safeValidateAutomation accepts valid tz", () => {
    const r = D.safeValidateAutomation({
      days: [2],
      windowStart: "08:00",
      windowEnd: "20:00",
      frequencyMin: 30,
      timeZone: "America/Cuiaba",
    } as any);
    expect(r.success).toBe(true);
  });
});

describe("QA reservation 2: advanceNextRunAt strictly after now", () => {
  it("returns strictly greater than now when now falls on a slot", () => {
    const group = { next_run_at: new Date("2026-10-13T08:00:00-04:00") };
    const cfg = {
      windowStart: "08:00",
      windowEnd: "20:00",
      frequencyMin: 30,
      days: [2],
      timeZone: "America/Cuiaba",
    };
    // now exactly at 12:00 local, which is a slot boundary (08:00 + 4*30min)
    const now = new Date("2026-10-13T12:00:00-04:00");
    const next = D.advanceNextRunAt(group as any, cfg as any, now);
    expect(next.getTime()).toBeGreaterThan(now.getTime());
  });

  it("missed slot after exact boundary returns later slot", () => {
    const group = { next_run_at: new Date("2026-10-13T08:00:00-04:00") };
    const cfg = {
      windowStart: "08:00",
      windowEnd: "20:00",
      frequencyMin: 30,
      days: [2],
      timeZone: "America/Cuiaba",
    };
    const now = new Date("2026-10-13T12:00:00.000-04:00");
    const next = D.advanceNextRunAt(group as any, cfg as any, now);
    // 12:30 next slot
    expect(next.toISOString()).toBe(new Date("2026-10-13T12:30:00-04:00").toISOString());
  });
});
