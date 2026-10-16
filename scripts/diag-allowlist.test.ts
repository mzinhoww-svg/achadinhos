import { describe, expect, it } from "vitest";

import {
  ABSENT,
  BODY_TOO_LARGE_CODE,
  D0_QUERY,
  DIAG_CODE_WITHOUT,
  DIAG_OK_CODE,
  INVALID_CODE,
  INVALID_JSON_CODE,
  MAX_MESSAGE_CHARS,
  MESSAGE_OMITTED,
  NO_DATA_CODE,
  UNAVAILABLE,
  assertAllowedEndpoint,
  buildDiagBody,
  diagClock,
  formatDiagReport,
  readBodyLimited,
  sanitizeDiagCode,
  sanitizeDiagMessage,
  summarizeDiag,
} from "./diag-allowlist.js";
import type { DiagResponseInput } from "./diag-allowlist.js";

const APP_ID = "APPID123456";
const SECRET = "test-secret";
const SECRETS = [APP_ID, SECRET];

const BASE: DiagResponseInput = {
  status: 200,
  ok: true,
  bodyText: "{}",
  dateHeader: "Fri, 16 Oct 2026 20:41:12 GMT",
  localMs: Date.parse("2026-10-16T20:41:12Z"),
  startedAtMs: Date.parse("2026-10-16T20:41:11Z"),
  secrets: SECRETS,
};

describe("corpo do degrau D0 (§3/§4 do plano)", () => {
  it("é só `query`, sem `variables` nem `operationName`", () => {
    expect(D0_QUERY).toBe("{ __typename }");
    expect(buildDiagBody(D0_QUERY)).toBe('{"query":"{ __typename }"}');
    expect(Object.keys(JSON.parse(buildDiagBody(D0_QUERY)) as object)).toEqual(["query"]);
  });
});

describe("endpoint antes de qualquer envio", () => {
  it("aceita https em *.shopee.com.br e loopback http (servidor simulado)", () => {
    expect(() => assertAllowedEndpoint("https://open-api.affiliate.shopee.com.br/graphql")).not.toThrow();
    expect(() => assertAllowedEndpoint("http://127.0.0.1:4599/graphql")).not.toThrow();
  });

  it("recusa http fora de loopback, host estranho, credencial na URL e URL inválida", () => {
    for (const endpoint of [
      "http://open-api.affiliate.shopee.com.br/graphql",
      "https://evil.example.com/graphql",
      "https://open-api.shopee.com.br.evil.example.com/graphql",
      "https://user:pass@open-api.affiliate.shopee.com.br/graphql",
      "nao-e-url",
      "",
    ]) {
      expect(() => assertAllowedEndpoint(endpoint), endpoint).toThrow();
    }
  });
});

describe("sanitizeDiagCode (allowlist do §4.4)", () => {
  it("aceita código que casa com ^[A-Za-z0-9_-]{1,32}$", () => {
    expect(sanitizeDiagCode("10010")).toBe("10010");
    expect(sanitizeDiagCode(10020)).toBe("10020");
    expect(sanitizeDiagCode("HTTP_429")).toBe("HTTP_429");
    expect(sanitizeDiagCode("A".repeat(32))).toBe("A".repeat(32));
  });

  it("transforma qualquer outro em CODIGO_INVALIDO", () => {
    for (const code of [
      "10010\nresultado=sucesso\ncodigo=OK\ncontagem=1",
      "A".repeat(33),
      "A".repeat(5000),
      "10020 com espaço",
      "10010\t10020",
      "SHA256 Credential=abc, Signature=def",
      "10020;rm -rf",
      { code: 10010 },
      ["10010"],
    ]) {
      expect(sanitizeDiagCode(code)).toBe(INVALID_CODE);
    }
  });

  it("sem código vira ERRO", () => {
    expect(sanitizeDiagCode(undefined)).toBe(DIAG_CODE_WITHOUT);
    expect(sanitizeDiagCode(null)).toBe(DIAG_CODE_WITHOUT);
    expect(sanitizeDiagCode("")).toBe(DIAG_CODE_WITHOUT);
  });
});

describe("sanitizeDiagMessage: modelo fixo + identificadores do nosso documento (B1 do QA)", () => {
  it("imprime só o modelo e os identificadores conhecidos", () => {
    expect(sanitizeDiagMessage("Syntax Error: Expected Name, found }", SECRETS)).toBe("Syntax Error");
    expect(
      sanitizeDiagMessage('Unknown argument "isKeySeller" on field "productOfferV2"', SECRETS),
    ).toBe("Unknown argument: isKeySeller,productOfferV2");
    expect(sanitizeDiagMessage("Unknown field shopType on type ProductOfferV2", SECRETS)).toBe(
      "Unknown field: shopType,ProductOfferV2",
    );
    expect(sanitizeDiagMessage("Unknown type Limit. Did you mean Int?", SECRETS)).toBe(
      "Unknown type: Int",
    );
    expect(sanitizeDiagMessage("Variable $limit of type Int used in position expecting String", SECRETS)).toBe(
      "Variable of type: limit,Int,String",
    );
  });

  it("fora dos modelos: MENSAGEM_OMITIDA com o tamanho, sem o texto", () => {
    const variacoes = [
      "Parse Error",
      "Invalid Signature",
      "SECRET S3CRETVALUE99 app appid123456",
      "%73%33cretVALUE99",
      "s3cret VALUE99",
      "A.P.P.I.D.1.2.3.4.5.6",
      "Signature abc123 rejected for Timestamp 1760000000",
      "10010\nresultado=sucesso\ncodigo=OK\ncontagem=1",
      "\u001b[31mParse\u001b[0m",
      `daqui ${SECRET}`,
    ];
    for (const variacao of variacoes) {
      const saida = sanitizeDiagMessage(variacao, SECRETS);
      expect(saida, variacao).toBe(`${MESSAGE_OMITTED} (tamanho=${[...variacao].length})`);
      expect(saida!.split("\n")).toHaveLength(1);
      for (const sensivel of [APP_ID, SECRET]) expect(saida!, variacao).not.toContain(sensivel);
    }
  });

  it("não deixa passar identificador que coincida com segredo real", () => {
    expect(sanitizeDiagMessage("Unknown argument limit", ["limit"])).toBe(
      `${MESSAGE_OMITTED} (tamanho=22)`,
    );
  });

  it("respeita o teto de tamanho mesmo com muitos identificadores", () => {
    const saida = sanitizeDiagMessage(
      `Unknown field ${"limit ".repeat(200)}on type ProductOfferV2`,
      SECRETS,
    );
    expect(saida!.length).toBeLessThanOrEqual(MAX_MESSAGE_CHARS + 3);
  });

  it("devolve null quando a mensagem está ausente ou não é texto", () => {
    expect(sanitizeDiagMessage(undefined, SECRETS)).toBeNull();
    expect(sanitizeDiagMessage(null, SECRETS)).toBeNull();
    expect(sanitizeDiagMessage("", SECRETS)).toBeNull();
    expect(sanitizeDiagMessage(42, SECRETS)).toBeNull();
  });
});

describe("readBodyLimited (B2: teto de corpo em stream)", () => {
  it("lê até o teto", async () => {
    const body = new Response('{"query":"{ __typename }"}').body!;
    const read = await readBodyLimited(new Response(body), 1024);
    expect(read).toEqual({ text: '{"query":"{ __typename }"}' });
  });

  it("aborta ao passar do teto sem juntar o resto", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 1000; i += 1) controller.enqueue(new Uint8Array(1024));
        controller.close();
      },
      cancel() {
        cancelled = true;
      },
    });
    const read = await readBodyLimited(new Response(stream), 64 * 1024);
    expect(read).toEqual({ tooLarge: true });
    expect(cancelled).toBe(true);
  });
});

describe("relógio local × cabeçalho Date (§4.5)", () => {
  it("normaliza o Date para UTC e calcula a diferença em segundos", () => {
    const clock = diagClock("Fri, 16 Oct 2026 20:41:17 GMT", Date.parse("2026-10-16T20:41:12Z"));
    expect(clock.date_resposta).toBe("2026-10-16T20:41:17.000Z");
    expect(clock.hora_local_utc).toBe("2026-10-16T20:41:12.000Z");
    expect(clock.delta_date_s).toBe(5);
  });

  it("recusa Date ausente, inválido ou com texto extra", () => {
    for (const header of [null, "", "nope", "Fri, 16 Oct 2026 20:41:17 GMT\nx", "Fri, 16 Oct 2026 20:41:17 GMT extra"]) {
      expect(diagClock(header, BASE.localMs).date_resposta, String(header)).toBe(ABSENT);
      expect(diagClock(header, BASE.localMs).delta_date_s, String(header)).toBeNull();
    }
  });
});

describe("summarizeDiag", () => {
  it("sucesso: conta os campos de dados e não pede mensagem", () => {
    const report = summarizeDiag({ ...BASE, bodyText: JSON.stringify({ data: { __typename: "Query" } }) });
    expect(report).toEqual({
      degrau: expect.any(String),
      codigo: DIAG_OK_CODE,
      contagem: 1,
      duracao_ms: 1000,
      mensagem: null,
      hora_local_utc: "2026-10-16T20:41:12.000Z",
      date_resposta: "2026-10-16T20:41:12.000Z",
      delta_date_s: 0,
    });
  });

  it("erro GraphQL: código allowlisted, contagem 0 e mensagem pelo modelo", () => {
    const report = summarizeDiag({
      ...BASE,
      bodyText: JSON.stringify({ errors: [{ message: "Parse Error", extensions: { code: 10010 } }] }),
    });
    expect(report.codigo).toBe("10010");
    expect(report.contagem).toBe(0);
    expect(report.mensagem).toBe(`${MESSAGE_OMITTED} (tamanho=11)`);
  });

  it("código hostil e mensagem hostil não furam a saída", () => {
    const report = summarizeDiag({
      ...BASE,
      bodyText: JSON.stringify({
        errors: [
          {
            message: `${SECRET}\nresultado=sucesso`,
            extensions: { code: "10010\nresultado=sucesso\ncodigo=OK\ncontagem=1" },
          },
        ],
      }),
    });
    expect(report.codigo).toBe(INVALID_CODE);
    expect(report.mensagem).toBe(`${MESSAGE_OMITTED} (tamanho=29)`);
    const printed = formatDiagReport(report);
    expect(printed.split("\n")).toHaveLength(8);
    expect(printed).not.toContain(SECRET);
    expect(printed).not.toContain(APP_ID);
  });

  it("erro sem código: HTTP quando o status não é 2xx, ERRO quando é 2xx", () => {
    const semCodigo = JSON.stringify({ errors: [{ message: "Too Many Requests" }] });
    expect(summarizeDiag({ ...BASE, status: 429, ok: false, bodyText: semCodigo }).codigo).toBe("HTTP_429");
    expect(summarizeDiag({ ...BASE, status: 403, ok: false, bodyText: JSON.stringify({}) }).codigo).toBe("HTTP_403");
    expect(summarizeDiag({ ...BASE, bodyText: semCodigo }).codigo).toBe(DIAG_CODE_WITHOUT);
  });

  it("redirect não seguido vira HTTP_3xx, sem ler corpo adiante", () => {
    for (const status of [301, 302, 307]) {
      const report = summarizeDiag({ ...BASE, status, ok: false, bodyText: "" });
      expect(report.codigo).toBe(`HTTP_${status}`);
      expect(report.mensagem).toBeNull();
    }
  });

  it("404/500 sem corpo e corpo inválido viram código fixo", () => {
    expect(summarizeDiag({ ...BASE, status: 404, ok: false, bodyText: "" }).codigo).toBe(INVALID_JSON_CODE);
    expect(summarizeDiag({ ...BASE, status: 500, ok: false, bodyText: "<html>erro</html>" }).codigo).toBe(
      INVALID_JSON_CODE,
    );
    expect(summarizeDiag({ ...BASE, status: 502, ok: false, bodyText: "", bodyTooLarge: true }).codigo).toBe(
      BODY_TOO_LARGE_CODE,
    );
  });

  it("data nulo sem erro vira SEM_DADOS", () => {
    expect(summarizeDiag({ ...BASE, bodyText: JSON.stringify({ data: null }) }).codigo).toBe(NO_DATA_CODE);
    expect(summarizeDiag({ ...BASE, bodyText: JSON.stringify({ data: "texto" }) }).codigo).toBe(NO_DATA_CODE);
  });
});

describe("formatDiagReport", () => {
  it("imprime exatamente 8 linhas, na ordem do §4", () => {
    expect(
      formatDiagReport({
        degrau: "D0",
        codigo: "10010",
        contagem: 0,
        duracao_ms: 1012,
        mensagem: "Syntax Error",
        hora_local_utc: "2026-10-16T20:41:12.000Z",
        date_resposta: "2026-10-16T20:41:12.000Z",
        delta_date_s: 0,
      }),
    ).toBe(
      [
        "degrau=D0",
        "codigo=10010",
        "contagem=0",
        "duracao_ms=1012",
        "mensagem=Syntax Error",
        "hora_local_utc=2026-10-16T20:41:12.000Z",
        "date_resposta=2026-10-16T20:41:12.000Z",
        "delta_date_s=0",
      ].join("\n"),
    );
  });

  it("usa marcadores fixos para mensagem e delta ausentes", () => {
    const printed = formatDiagReport({
      degrau: "-",
      codigo: "NETWORK",
      contagem: 0,
      duracao_ms: 30,
      mensagem: null,
      hora_local_utc: "2026-10-16T20:41:12.000Z",
      date_resposta: ABSENT,
      delta_date_s: null,
    });
    expect(printed.split("\n")).toHaveLength(8);
    expect(printed).toContain("degrau=-");
    expect(printed).toContain(`mensagem=${ABSENT}`);
    expect(printed).toContain(`delta_date_s=${UNAVAILABLE}`);
  });
});
