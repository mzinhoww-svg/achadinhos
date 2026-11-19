import { describe, expect, it } from "vitest";
import { permitir } from "./limite";

describe("limite do /r", () => {
  it("passa 30 por minuto por IP e bloqueia o 31º; outro IP segue livre; a janela vira", () => {
    const t = 1_000_000;
    for (let i = 0; i < 30; i++) expect(permitir("ip-a", 30, t)).toBe(true);
    expect(permitir("ip-a", 30, t)).toBe(false);
    expect(permitir("ip-b", 30, t)).toBe(true);
    expect(permitir("ip-a", 30, t + 60_001)).toBe(true);
  });
});
