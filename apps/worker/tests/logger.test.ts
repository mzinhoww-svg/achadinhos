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

describe("logger nunca lança", () => {
  const cases: Array<[string, () => Record<string, unknown>]> = [
    ["BigInt", () => ({ n: 10n })],
    ["getter que lança", () => ({ get boom(): string { throw new Error("boom"); } })],
    ["Proxy com ownKeys que lança", () => ({ p: new Proxy({}, { ownKeys() { throw new Error("proxy"); } }) })],
    ["símbolo e função", () => ({ s: Symbol("x"), f: () => 1 })],
    ["toJSON que lança", () => ({ t: { toJSON() { throw new Error("tojson"); } } })],
  ];
  for (const [name, make] of cases) {
    it(`contexto com ${name}`, () => {
      const { log, lines } = setup();
      expect(() => log.error("falhou", make())).not.toThrow();
      expect(JSON.parse(lines[0]!).msg).toBe("falhou");
    });
  }

  it("objeto aninhado em 10 000 níveis", () => {
    const { log, lines } = setup();
    let o: Record<string, unknown> = { leaf: "CANARY-DEEP" };
    for (let i = 0; i < 10_000; i++) o = { o };
    expect(() => log.info("fundo", { o })).not.toThrow();
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("CANARY-DEEP");
  });

  it("sink que lança não propaga", () => {
    const log = createLogger({ sink: () => { throw new Error("disco cheio"); } });
    expect(() => log.error("x")).not.toThrow();
  });

  it("mensagem não-string não lança", () => {
    const { log } = setup();
    expect(() => log.info(undefined as unknown as string)).not.toThrow();
  });

  it("trunca strings longas", () => {
    const { log, lines } = setup();
    log.info("x", { body: "a".repeat(50_000) });
    expect(lines[0]!.length).toBeLessThan(3_000);
  });

  it("mesmo objeto referenciado duas vezes não vira [Circular]", () => {
    const { log, lines } = setup();
    const shared = { v: 1 };
    log.info("x", { a: shared, b: shared });
    const o = JSON.parse(lines[0]!);
    expect(o.a).toEqual({ v: 1 });
    expect(o.b).toEqual({ v: 1 });
  });

  it("Buffer, Date e Map não vazam conteúdo bruto", () => {
    const { log, lines } = setup();
    log.info("x", { buf: Buffer.from("CANARY-BUF"), d: new Date("2026-10-14T00:00:00Z"), m: new Map([["k", "CANARY-MAP"]]) });
    expect(lines[0]).not.toContain("CANARY-BUF");
    expect(lines[0]).not.toContain("CANARY-MAP");
    expect(JSON.parse(lines[0]!).d).toBe("2026-10-14T00:00:00.000Z");
  });
});

describe("redação em qualquer forma (sem addSecret prévio)", () => {
  const out = (ctx: Record<string, unknown>, msg = "m") => {
    const { log, lines } = setup();
    log.info(msg, ctx);
    return lines[0]!;
  };

  it("URL do banco com senha, em valor de chave neutra e em texto", () => {
    const url = "postgresql://postgres.abc:Sup3rS3nhaDB@host:6543/postgres";
    expect(out({ url })).not.toContain("Sup3rS3nhaDB");
    expect(out({}, `conectando em ${url}`)).not.toContain("Sup3rS3nhaDB");
  });

  it("header Authorization da Shopee em texto livre", () => {
    const h = "Authorization: SHA256 Credential=18350000042, Timestamp=1760000000, Signature=3fa9c1d2e4b5a6978877665544332211ffeeddccbbaa99887766554433221100";
    const s = out({}, h);
    expect(s).not.toContain("18350000042");
    expect(s).not.toContain("3fa9c1d2e4b5");
  });

  it("par chave=valor de segredo em query string, inclusive URL-encoded", () => {
    const s = out({}, "GET /x?token=a%2Fb%2Bc%3Dd%26e&apikey=ZZZ999&ok=1");
    expect(s).not.toContain("a%2Fb");
    expect(s).not.toContain("ZZZ999");
    expect(s).toContain("ok=1");
  });

  it("segredo registrado some também URL-encoded, JSON-escaped e em base64", () => {
    const secret = 'p@ss/w"rd+1';
    const { log, lines } = setup([secret]);
    log.info(`a ${encodeURIComponent(secret)} b ${JSON.stringify(secret).slice(1, -1)} c ${Buffer.from(secret).toString("base64")}`);
    const l = lines[0]!;
    expect(l).not.toContain(encodeURIComponent(secret));
    expect(l).not.toContain(JSON.stringify(secret).slice(1, -1));
    expect(l).not.toContain(Buffer.from(secret).toString("base64"));
  });

  it("registrar URL do banco registra também a senha isolada", () => {
    const { log, lines } = setup();
    log.addSecret("postgres://worker:Sup3rS3nhaDB@db:5432/postgres");
    log.info("falha de login com Sup3rS3nhaDB");
    expect(lines[0]).not.toContain("Sup3rS3nhaDB");
  });

  it("chave sensível dentro de Map/array de pares e em Error com props", () => {
    const e = Object.assign(new Error("x"), { token: "CANARY-PROP", config: { password: "CANARY-PW" } });
    const s = out({ e });
    expect(s).not.toContain("CANARY-PROP");
    expect(s).not.toContain("CANARY-PW");
  });
});

describe("nível", () => {
  it("filtra abaixo do nível mínimo", () => {
    const lines: string[] = [];
    const log = createLogger({ sink: (l) => lines.push(l), level: "warn" });
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");
    expect(lines.map((l) => JSON.parse(l).msg)).toEqual(["w", "e"]);
  });
});
