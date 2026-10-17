import { describe, expect, it } from "vitest";

import { ArgvError, parseArgs } from "../../src/gerar/argv.js";

describe("parseArgs", () => {
  it("lê flags com valor separado e com '='", () => {
    expect(
      parseArgs([
        "--limite",
        "5",
        "--outbox=out",
        "--grupo",
        "Promoções",
        "--grupo-indice",
        "2",
        "--keyword",
        "fone",
        "--handle",
        "@afiliado",
        "--endpoint",
        "http://127.0.0.1:1234/graphql",
      ]),
    ).toEqual({
      limit: 5,
      outbox: "out",
      groupLabel: "Promoções",
      groupIndex: 2,
      keyword: "fone",
      handle: "@afiliado",
      endpoint: "http://127.0.0.1:1234/graphql",
    });
  });

  it("reconhece --help e -h", () => {
    expect(parseArgs(["--help"])).toEqual({ help: true });
    expect(parseArgs(["-h"])).toEqual({ help: true });
  });

  it("recusa valor ausente", () => {
    expect(() => parseArgs(["--limite"])).toThrow(ArgvError);
    expect(() => parseArgs(["--outbox", "--limite"])).toThrow(ArgvError);
  });

  it("recusa número inválido", () => {
    expect(() => parseArgs(["--limite", "abc"])).toThrow(ArgvError);
    expect(() => parseArgs(["--grupo-indice", "1.5"])).toThrow(ArgvError);
  });

  it("recusa argumento desconhecido", () => {
    expect(() => parseArgs(["--nope"])).toThrow(ArgvError);
  });
});
