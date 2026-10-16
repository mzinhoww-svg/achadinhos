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
  NO_DATA_CODE,
  UNAVAILABLE,
  assertAllowedEndpoint,
  buildDiagBody,
  diagClock,
  formatDiagReport,
  sanitizeDiagCode,
  sanitizeDiagMessage,
  summarizeDiag,
} from "./diag-allowlist.js";
import type { DiagResponseInput } from "./diag-allowlist.js";

const APP_ID = "12345678901";
const SECRET = "abcdef0123456789abcdef0123456789";
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
    ]) {      expect(sanitizeDiagCode(code)).toBe(INVALID_CODE);
    }
  });

  it("sem código vira ERRO", () => {
    expect(sanitizeDiagCode(undefined)).toBe(DIAG_CODE_WITHOUT);
    expect(sanitizeDiagCode(null)).toBe(DIAG_CODE_WITHOUT);
    expect(sanitizeDiagCode("")).toBe(DIAG_CODE_WITHOUT);
  });
});

describe("sanitizeDiagMessage (§4.4: ASCII imprimível, sem controle, com teto)", () => {
  it("preserva a mensagem útil", () => {
    expect(sanitizeDiagMessage("Parse Error", SECRETS)).toBe("Parse Error");
    expect(sanitizeDiagMessage("Invalid Signature", SECRETS)).toBe("Invalid Signature");
  });

  it("mata quebra de linha, controle e ANSI (nunca duas linhas)", () => {
    expect(sanitizeDiagMessage("10010\nresultado=sucesso", SECRETS)).toBe("10010 resultado=sucesso");
    expect(sanitizeDiagMessage("\u001b[31mParse\u001b[0m", SECRETS)).toBe("[31mParse [0m");
    expect(sanitizeDiagMessage("a\rb\u0000c", SECRETS)).toBe("a b c");
    expect(sanitizeDiagMessage("\n\t \u0007", SECRETS)).toBeNull();
  });

  it("mascara valor de cabeçalho, App ID, Secret e token longo", () => {
    const message = `SHA256 Credential=${APP_ID}, Signature=${SECRET}, Timestamp=1700000000`;
    const sanitized = sanitizeDiagMessage(message, SECRETS);
    expect(sanitized).not.toContain(APP_ID);
    expect(sanitized).not.toContain(SECRET);
    expect(sanitized).toContain("Credential=[REDACTED]");
    expect(sanitized).toContain("Signature=[REDACTED]");
    expect(sanitized).not.toContain("1700000000");
    expect(sanitizeDiagMessage(`hash ${"a".repeat(64)} fim`, SECRETS)).toBe("hash [REDACTED] fim");
  });

  it("aplica teto de tamanho e devolve null quando não sobra texto", () => {
    const longo = sanitizeDiagMessage("palavra ".repeat(200), SECRETS);
    expect(longo).not.toBeNull();
    expect(longo!.length).toBeLessThanOrEqual(MAX_MESSAGE_CHARS + 3);
    expect(longo!.endsWith("...")).toBe(true);
    // Máscara antes do teto: corrida longa não deixa metade de token na borda.
    expect(sanitizeDiagMessage("m".repeat(5000), SECRETS)).toBe("[REDACTED]");
    expect(sanitizeDiagMessage(undefined, SECRETS)).toBeNull();
    expect(sanitizeDiagMessage(42 as unknown, SECRETS)).toBeNull();
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

  it("erro GraphQL: código allowlisted, contagem 0 e mensagem saneada", () => {
    const report = summarizeDiag({
      ...BASE,
      bodyText: JSON.stringify({ errors: [{ message: "Parse Error", extensions: { code: 10010 } }] }),
    });
    expect(report.codigo).toBe("10010");
    expect(report.contagem).toBe(0);
    expect(report.mensagem).toBe("Parse Error");
  });

  it("código hostil e mensagem hostil não furassem a saída", () => {
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
    expect(report.mensagem).not.toContain(SECRET);
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

  it("404/500 sem corpo e corpo inválido viram código fixo", () => {
    expect(summarizeDiag({ ...BASE, status: 404, ok: false, bodyText: "" }).codigo).toBe("INVALID_JSON");
    expect(summarizeDiag({ ...BASE, status: 500, ok: false, bodyText: "<html>erro</html>" }).codigo).toBe(
      INVALID_JSON_CODE,
    );
    expect(summarizeDiag({ ...BASE, status: 502, ok: false, bodyText: "x".repeat(70 * 1024) }).codigo).toBe(
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
        mensagem: "Parse Error",
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
        "mensagem=Parse Error",
        "hora_local_utc=2026-10-16T20:41:12.000Z",
        "date_resposta=2026-10-16T20:41:12.000Z",
        "delta_date_s=0",
      ].join("\n"),
    );
  });

  it("usa marcadores fixos para mensagem e delta ausentes", () => {
    const printed = formatDiagReport({
      degrau: "D0",
      codigo: "NETWORK",
      contagem: 0,
      duracao_ms: 30,
      mensagem: null,
      hora_local_utc: "2026-10-16T20:41:12.000Z",
      date_resposta: ABSENT,
      delta_date_s: null,
    });
    expect(printed.split("\n")).toHaveLength(8);
    expect(printed).toContain(`mensagem=${ABSENT}`);
    expect(printed).toContain(`delta_date_s=${UNAVAILABLE}`);
  });
});
