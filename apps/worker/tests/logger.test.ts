import { describe, expect, it } from "vitest";
import { createLogger, REDACTED } from "../src/logger.js";

function setup(secrets: string[] = []) {
  const lines: string[] = [];
  const log = createLogger({ sink: (l) => lines.push(l), secrets, now: () => new Date("2026-10-14T12:00:00Z") });
  return { log, lines };
}

describe("logger", () => {
  it("emite JSON com ts em UTC, nível e msg", () => {
    const { log, lines } = setup();
    log.info("tick", { n: 1 });
    expect(JSON.parse(lines[0]!)).toMatchObject({ ts: "2026-10-14T12:00:00.000Z", level: "info", msg: "tick", n: 1 });
  });

  it("redige campos por nome de chave, em qualquer profundidade", () => {
    const { log, lines } = setup();
    log.info("x", { secret: "abc", nested: { Authorization: "SHA256 Credential=1", token: "t", ok: "v" }, arr: [{ password: "p" }] });
    const out = lines[0]!;
    expect(out).not.toMatch(/abc|SHA256 Credential|"t"|"p"/);
    expect(out).toContain(REDACTED);
    expect(out).toContain('"ok":"v"');
  });

  it("redige valores conhecidos dentro de strings livres", () => {
    const { log, lines } = setup(["CANARY-SECRET-VALUE"]);
    log.error("falha ao chamar https://api.telegram.org/botCANARY-SECRET-VALUE/sendPhoto");
    expect(lines[0]).not.toContain("CANARY-SECRET-VALUE");
  });

  it("redige padrão de token do Telegram e Bearer mesmo sem registro prévio", () => {
    const { log, lines } = setup();
    log.warn("erro", { detail: "url /bot123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw/getMe Bearer abc.def-ghi" });
    expect(lines[0]).not.toContain("AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw");
    expect(lines[0]).not.toContain("abc.def-ghi");
  });

  it("serializa Error sem vazar segredo na message, stack ou cause", () => {
    const { log, lines } = setup(["CANARY-SECRET-VALUE"]);
    const err = new Error("boom CANARY-SECRET-VALUE", { cause: new Error("inner CANARY-SECRET-VALUE") });
    log.error("falhou", { err });
    expect(lines[0]).not.toContain("CANARY-SECRET-VALUE");
    expect(JSON.parse(lines[0]!).err.message).toContain("boom");
  });

  it("não quebra com referência circular", () => {
    const { log, lines } = setup();
    const a: Record<string, unknown> = { name: "a" };
    a.self = a;
    log.info("circ", { a });
    expect(JSON.parse(lines[0]!).a.self).toBe("[Circular]");
  });

  it("addSecret passa a redigir valor registrado depois", () => {
    const { log, lines } = setup();
    log.addSecret("LATE-SECRET-123");
    log.info("v LATE-SECRET-123");
    expect(lines[0]).not.toContain("LATE-SECRET-123");
  });
});
