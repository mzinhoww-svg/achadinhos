import { describe, expect, it } from "vitest";
import { isUnknownResultReason, UNKNOWN_RESULT_SUFFIX } from "../index";

describe("motivo de resultado desconhecido (A5)", () => {
  it("o sufixo é o mesmo do índice de dedupe SQL", () => {
    expect(UNKNOWN_RESULT_SUFFIX).toBe("_resultado_desconhecido");
  });
  it.each([
    "lease_expirado_resultado_desconhecido",
    "telegram_timeout_resultado_desconhecido",
    "telegram_transporte_resultado_desconhecido",
    "telegram_resposta_invalida_resultado_desconhecido",
  ])("%s bloqueia repetição", (r) => expect(isUnknownResultReason(r)).toBe(true));
  it.each([null, undefined, "", "telegram_bot_removido", "link_invalido", "resultado_desconhecido", "x_resultado_desconhecido_y", 7])(
    "%j não bloqueia",
    (r) => expect(isUnknownResultReason(r)).toBe(false),
  );
});
