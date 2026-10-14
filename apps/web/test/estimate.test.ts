import { describe, expect, it } from "vitest";
import { estimatePostsPerDay, minutesBetween } from "@/lib/estimate";

describe("estimatePostsPerDay", () => {
  it("grupos × (janela ÷ frequência)", () => {
    expect(estimatePostsPerDay({ groups: 2, windowStart: "08:00", windowEnd: "20:00", frequencyMin: 30 }).raw).toBe(48);
  });
  it("limita pelo teto diário de 200", () => {
    const r = estimatePostsPerDay({ groups: 10, windowStart: "06:00", windowEnd: "23:00", frequencyMin: 15 });
    expect(r.capped).toBe(200);
    expect(r.hitCap).toBe(true);
  });
  it("janela que cruza a meia-noite soma 24h (22:00→02:00 = 4h)", () => {
    expect(minutesBetween("22:00", "02:00")).toBe(240);
  });
  it("janela vazia = 0", () => {
    expect(estimatePostsPerDay({ groups: 3, windowStart: "10:00", windowEnd: "10:00", frequencyMin: 60 }).capped).toBe(0);
  });
  it("zero grupos = 0", () => {
    expect(estimatePostsPerDay({ groups: 0, windowStart: "08:00", windowEnd: "20:00", frequencyMin: 15 }).capped).toBe(0);
  });
});
