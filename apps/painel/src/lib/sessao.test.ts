import { describe, expect, it } from "vitest";
import { criarToken, DURACAO_SESSAO_MS, lerToken } from "./sessao";

const S = "s".repeat(40);

describe("sessão", () => {
  it("assina e lê", () => {
    const t = criarToken({ id: 1, email: "a@b.com", nome: "A" }, 1000, S);
    expect(lerToken(t, 2000, S)).toMatchObject({ id: 1, email: "a@b.com" });
  });
  it("recusa token alterado, de outro segredo ou vencido", () => {
    const t = criarToken({ id: 1, email: "a@b.com", nome: "A" }, 1000, S);
    const [d, a] = t.split(".");
    const falso = `${Buffer.from(JSON.stringify({ id: 2, email: "x@y.com", nome: "X", exp: 9e15 })).toString("base64url")}.${a}`;
    expect(lerToken(falso, 2000, S)).toBeNull();
    expect(lerToken(`${d}.${a}`, 2000, "o".repeat(40))).toBeNull();
    expect(lerToken(t, 1000 + DURACAO_SESSAO_MS + 1, S)).toBeNull();
    expect(lerToken(undefined, 0, S)).toBeNull();
  });
  it("exige AUTH_SECRET longo", () => {
    expect(() => criarToken({ id: 1, email: "a@b.com", nome: "A" }, 0, "curto")).toThrow(/AUTH_SECRET/);
  });
});
