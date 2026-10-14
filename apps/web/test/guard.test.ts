import { describe, expect, it, vi } from "vitest";
import { guarded } from "@/server/session";
import { sessionOf } from "./helpers";

describe("T8-01 guarda de sessão", () => {
  it("sem sessão: recusa e não executa o handler", async () => {
    const handler = vi.fn(async () => "x");
    const r = await guarded(sessionOf(null), handler)({});
    expect(r).toMatchObject({ ok: false, code: "unauthorized" });
    expect(handler).not.toHaveBeenCalled();
  });
  it("entrega ao handler a conta da SESSÃO", async () => {
    const r = await guarded(sessionOf("acc_A"), async (s) => s.accountId)({ name: "x" });
    expect(r).toEqual({ ok: true, data: "acc_A" });
  });
  it.each([{ account_id: "acc_B" }, { accountId: "acc_B" }, { account_id: "acc_A" }])(
    "account_id vindo do cliente é recusado (%o)",
    async (input) => {
      const handler = vi.fn(async () => 1);
      const r = await guarded(sessionOf("acc_A"), handler)(input);
      expect(r).toMatchObject({ ok: false, code: "forbidden" });
      expect(handler).not.toHaveBeenCalled();
    },
  );
  it("FormData com account_id é recusado", async () => {
    const fd = new FormData();
    fd.set("account_id", "acc_B");
    const r = await guarded(sessionOf("acc_A"), async () => 1)(fd);
    expect(r).toMatchObject({ ok: false, code: "forbidden" });
  });
  it("erro inesperado vira mensagem genérica, sem vazar detalhe", async () => {
    const r = await guarded(sessionOf("acc_A"), async () => {
      throw new Error("falhou com TOKEN-123");
    })({});
    expect(JSON.stringify(r)).not.toContain("TOKEN-123");
  });
  it("provider que lança = sem sessão", async () => {
    const r = await guarded({ current: async () => { throw new Error("db"); } }, async () => 1)({});
    expect(r).toMatchObject({ ok: false, code: "unauthorized" });
  });
});
