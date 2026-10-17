import { describe, expect, it } from "vitest";
import { AUTOMATIONS_FILE_CODES, parseAutomationsConfig } from "../automation";

const base = {
  name: "Promo",
  filters: { minDiscount: 20 },
  days: [0, 1, 2, 3, 4, 5, 6],
  windowStart: "00:00",
  windowEnd: "23:59",
  frequencyMin: 30,
  timeZone: "America/Cuiaba",
};

describe("parseAutomationsConfig (T7-D)", () => {
  it("aceita { automacoes: [...] } e também um array cru", () => {
    const viaObjeto = parseAutomationsConfig({ automacoes: [base] });
    expect(viaObjeto.ok).toBe(true);
    if (viaObjeto.ok) {
      expect(viaObjeto.automations).toHaveLength(1);
      expect(viaObjeto.automations[0]?.name).toBe("Promo");
    }
    const viaArray = parseAutomationsConfig([base, base]);
    expect(viaArray.ok).toBe(true);
    if (viaArray.ok) expect(viaArray.automations).toHaveLength(2);
  });

  it("aceita lista vazia (nenhuma automação)", () => {
    expect(parseAutomationsConfig({ automacoes: [] })).toEqual({ ok: true, automations: [] });
  });

  it("recusa a 6ª automação (limite 5)", () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ ...base, name: `A${i}` }));
    expect(parseAutomationsConfig({ automacoes: six })).toEqual({
      ok: false,
      code: AUTOMATIONS_FILE_CODES.limite,
    });
  });

  it("falha fechado em formato inválido", () => {
    expect(parseAutomationsConfig(null)).toEqual({ ok: false, code: AUTOMATIONS_FILE_CODES.invalidas });
    expect(parseAutomationsConfig(42)).toEqual({ ok: false, code: AUTOMATIONS_FILE_CODES.invalidas });
    expect(parseAutomationsConfig({})).toEqual({ ok: false, code: AUTOMATIONS_FILE_CODES.invalidas });
    expect(parseAutomationsConfig({ automacoes: "x" })).toEqual({ ok: false, code: AUTOMATIONS_FILE_CODES.invalidas });
  });

  it("recusa automação inválida inteira (janela, dias, fuso)", () => {
    const bad = [
      { ...base, windowStart: "25:00" },
      { ...base, windowStart: "10:00", windowEnd: "10:00" },
      { ...base, days: [] },
      { ...base, frequencyMin: 45 },
      { ...base, timeZone: "Mars/Phobos" },
    ];
    for (const item of bad) {
      expect(parseAutomationsConfig({ automacoes: [item] })).toEqual({
        ok: false,
        code: AUTOMATIONS_FILE_CODES.invalidas,
      });
    }
  });
});
