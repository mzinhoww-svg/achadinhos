import { describe, expect, it } from "vitest";
import { createHeartbeat } from "../src/heartbeat.js";

describe("heartbeat", () => {
  it("antes do primeiro tick está stale (falha fechada)", () => {
    const hb = createHeartbeat({ now: () => 1000, staleAfterMs: 180_000 });
    expect(hb.status().healthy).toBe(false);
  });

  it("saudável logo após beat e stale depois de 3 min sem tick", () => {
    let t = 0;
    const hb = createHeartbeat({ now: () => t, staleAfterMs: 180_000 });
    hb.beat();
    t = 179_999;
    expect(hb.status().healthy).toBe(true);
    t = 180_001;
    const s = hb.status();
    expect(s.healthy).toBe(false);
    expect(s.sinceLastBeatMs).toBe(180_001);
  });

  it("runTick marca beat só quando o tick termina e propaga erro sem marcar", async () => {
    let t = 0;
    const hb = createHeartbeat({ now: () => t, staleAfterMs: 1000 });
    await hb.runTick(async () => {
      t = 10;
    });
    expect(hb.status().lastBeatAt).toBe(10);
    t = 20;
    await expect(hb.runTick(async () => { throw new Error("x"); })).rejects.toThrow("x");
    expect(hb.status().lastBeatAt).toBe(10);
    expect(hb.status().consecutiveFailures).toBe(1);
  });

  it("tick que trava não marca beat (ficaria stale)", async () => {
    let t = 0;
    const hb = createHeartbeat({ now: () => t, staleAfterMs: 1000 });
    void hb.runTick(() => new Promise<void>(() => {}));
    t = 5000;
    expect(hb.status().healthy).toBe(false);
  });
});
