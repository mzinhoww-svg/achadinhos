/**
 * T12 — saída do modo de diagnóstico por **allowlist** (§4 do plano
 * docs/plans/shopee-diagnostico-10010.md; achado B1 do QA no PR #41).
 *
 * Regras que este módulo implementa: resposta da Shopee é dado, não texto de
 * terminal.
 * - `codigo` só sai se casar com `^[A-Za-z0-9_-]{1,32}$`, senão `CODIGO_INVALIDO`
 *   (mesma regra da sonda em `packages/shopee/src/live-check.ts`).
 * - `mensagem` é opcional, vira ASCII imprimível (sem `\n`, `\r`, controle ou
 *   ANSI), tem teto de tamanho e passa por máscara de App ID, Secret, valor de
 *   cabeçalho e token longo.
 * - Relógio: horário local e cabeçalho `Date` viram UTC + diferença em segundos
 *   (§4.5); `Date` fora do formato RFC 1123 vira `ausente`.
 * - O endpoint passa por allowlist antes de qualquer envio (o Secret nunca vai
 *   para host fora de `*.shopee.com.br`, exceto loopback do servidor simulado).
 */

export const DEGRAU_D0 = "D0";
/** D0: só o tipo da raiz, corpo apenas com `query` (§3). */
export const D0_QUERY = "{ __typename }";

export const DIAG_OK_CODE = "OK";
export const DIAG_CODE_WITHOUT = "ERRO";
export const INVALID_CODE = "CODIGO_INVALIDO";
export const INVALID_JSON_CODE = "INVALID_JSON";
export const BODY_TOO_LARGE_CODE = "BODY_TOO_LARGE";
export const NO_DATA_CODE = "SEM_DADOS";
export const ABSENT = "ausente";
export const UNAVAILABLE = "indisponivel";

export const MAX_MESSAGE_CHARS = 120;
export const MAX_BODY_BYTES = 64 * 1024;

/** Mesma allowlist de código da sonda do PR #41. */
const SAFE_CODE = /^[A-Za-z0-9_-]{1,32}$/;
/** `Date` de resposta HTTP: RFC 1123 estrito, sem texto extra. */
const HTTP_DATE = /^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/;
/** Valor de campo que carrega segredo no cabeçalho de assinatura. */
const HEADER_VALUE = /\b(Credential|Signature|Timestamp|Authorization)\s*=\s*\S+/gi;
/** Corrida longa de caracteres "de token" (hash de assinatura, App ID colado). */
const LONG_TOKEN = /[A-Za-z0-9+/=_-]{20,}/g;

const ALLOWED_HOST_SUFFIX = ".shopee.com.br";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** Recusa de configuração: a mensagem nunca ecoa a URL nem o valor recebido. */
export class DiagRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiagRefusedError";
  }
}

/** Corpo do degrau: sempre só `query` — sem `variables`, sem `operationName`. */
export function buildDiagBody(query: string): string {
  return JSON.stringify({ query });
}

/**
 * Exige https em `*.shopee.com.br` (ou loopback http, do servidor simulado)
 * antes de qualquer envio: o header de assinatura não sai para outro host.
 */
export function assertAllowedEndpoint(endpoint: string): URL {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new DiagRefusedError("endpoint is not a valid URL");
  }
  if (url.username || url.password) {
    throw new DiagRefusedError("endpoint must not embed credentials");
  }
  const host = url.hostname.toLowerCase();
  if (LOOPBACK_HOSTS.has(host) && (url.protocol === "http:" || url.protocol === "https:")) {
    return url;
  }
  if (url.protocol !== "https:") {
    throw new DiagRefusedError("endpoint must use https");
  }
  if (!host.endsWith(ALLOWED_HOST_SUFFIX) || host.length === ALLOWED_HOST_SUFFIX.length) {
    throw new DiagRefusedError("endpoint host is not allowed");
  }
  return url;
}

/** Código: number finito ou string na allowlist; qualquer outra coisa é recusado. */
export function sanitizeDiagCode(code: unknown): string {
  if (code === undefined || code === null || code === "") return DIAG_CODE_WITHOUT;
  if (typeof code === "number") {
    return Number.isFinite(code) && SAFE_CODE.test(String(code)) ? String(code) : INVALID_CODE;
  }
  if (typeof code !== "string") return INVALID_CODE;
  return SAFE_CODE.test(code) ? code : INVALID_CODE;
}

/**
 * Mensagem: máscara primeiro (sobre o texto inteiro, para não deixar metade de
 * token na borda), teto depois. Devolve `null` quando não sobra texto útil.
 */
export function sanitizeDiagMessage(message: unknown, secrets: readonly string[]): string | null {
  if (typeof message !== "string" || message.length === 0) return null;

  let text = "";
  for (const char of message) {
    const point = char.codePointAt(0) ?? 0;
    text += point >= 0x20 && point <= 0x7e ? char : " ";
  }
  text = text.replace(/\s+/g, " ").trim();

  text = text.replace(HEADER_VALUE, (_match, key: string) => `${key}=[REDACTED]`);
  for (const secret of secrets) {
    if (secret.length >= 4) text = text.split(secret).join("[REDACTED]");
  }
  text = text.replace(LONG_TOKEN, "[REDACTED]").trim();

  if (text.length === 0) return null;
  if (text.length > MAX_MESSAGE_CHARS) {
    return `${text.slice(0, MAX_MESSAGE_CHARS).trimEnd()}...`;
  }
  return text;
}

export type DiagClock = {
  hora_local_utc: string;
  date_resposta: string;
  delta_date_s: number | null;
};

/** §4.5: horário local (UTC), `Date` da resposta normalizado e diferença em segundos. */
export function diagClock(dateHeader: string | null, localMs: number): DiagClock {
  const hora_local_utc = new Date(localMs).toISOString();
  if (typeof dateHeader !== "string" || !HTTP_DATE.test(dateHeader)) {
    return { hora_local_utc, date_resposta: ABSENT, delta_date_s: null };
  }
  const parsed = Date.parse(dateHeader);
  if (Number.isNaN(parsed)) {
    return { hora_local_utc, date_resposta: ABSENT, delta_date_s: null };
  }
  return {
    hora_local_utc,
    date_resposta: new Date(parsed).toISOString(),
    delta_date_s: Math.round((parsed - localMs) / 1000),
  };
}

export type DiagReport = {
  degrau: string;
  codigo: string;
  contagem: number;
  duracao_ms: number;
  mensagem: string | null;
  hora_local_utc: string;
  date_resposta: string;
  delta_date_s: number | null;
};

export type DiagResponseInput = {
  /** Dados do transporte; nenhum cabeçalho além do `Date` é lido. */
  status: number;
  ok: boolean;
  bodyText: string;
  /** O chamador já sabe que o corpo passou do teto (evita guardar o corpo inteiro). */
  bodyTooLarge?: boolean;
  dateHeader: string | null;
  localMs: number;
  startedAtMs: number;
  secrets: readonly string[];
  degrau?: string;
};

/** Resumo allowlisted de uma resposta (ou do que sobrou dela). */
export function summarizeDiag(input: DiagResponseInput): DiagReport {
  const clock = diagClock(input.dateHeader, input.localMs);
  const base = {
    degrau: input.degrau ?? DEGRAU_D0,
    contagem: 0,
    duracao_ms: Math.max(0, Math.round(input.localMs - input.startedAtMs)),
    ...clock,
  };

  if (input.bodyTooLarge === true || Buffer.byteLength(input.bodyText) > MAX_BODY_BYTES) {
    return { ...base, codigo: BODY_TOO_LARGE_CODE, mensagem: null };
  }

  let json: unknown;
  try {
    json = JSON.parse(input.bodyText);
  } catch {
    return { ...base, codigo: INVALID_JSON_CODE, mensagem: null };
  }

  const envelope = json as { data?: unknown; errors?: unknown } | null;
  const errors = Array.isArray(envelope?.errors) ? (envelope.errors as unknown[]) : [];

  if (errors.length > 0) {
    const first = errors[0] as { message?: unknown; extensions?: { code?: unknown } } | undefined;
    const code = first?.extensions?.code;
    return {
      ...base,
      codigo:
        code === undefined || code === null || code === ""
          ? input.ok
            ? DIAG_CODE_WITHOUT
            : `HTTP_${input.status}`
          : sanitizeDiagCode(code),
      mensagem: sanitizeDiagMessage(first?.message, input.secrets),
    };
  }

  if (!input.ok) return { ...base, codigo: `HTTP_${input.status}`, mensagem: null };

  const data = envelope?.data;
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    // 2xx sem erro e sem nó de dados: resposta que não prova nada.
    return { ...base, codigo: NO_DATA_CODE, mensagem: null };
  }

  return { ...base, codigo: DIAG_OK_CODE, contagem: Object.keys(data).length, mensagem: null };
}

/** Oito linhas, nessa ordem, e nada mais. */
export function formatDiagReport(report: DiagReport): string {
  return [
    `degrau=${report.degrau}`,
    `codigo=${report.codigo}`,
    `contagem=${report.contagem}`,
    `duracao_ms=${report.duracao_ms}`,
    `mensagem=${report.mensagem ?? ABSENT}`,
    `hora_local_utc=${report.hora_local_utc}`,
    `date_resposta=${report.date_resposta}`,
    `delta_date_s=${report.delta_date_s ?? UNAVAILABLE}`,
  ].join("\n");
}
