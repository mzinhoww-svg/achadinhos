/**
 * T12 — saída do modo de diagnóstico por **allowlist** (§4 do plano
 * docs/plans/shopee-diagnostico-10010.md; achado B1 do QA no PR #41).
 *
 * Regras que este módulo implementa: resposta da Shopee é dado, não texto de
 * terminal.
 * - `codigo` só sai se casar com `^[A-Za-z0-9_-]{1,32}$`, senão `CODIGO_INVALIDO`
 *   (mesma regra da sonda em `packages/shopee/src/live-check.ts`).
 * - `mensagem` **não é redação**: só passa um modelo fixo de erro GraphQL
 *   (Syntax Error / Unknown argument / Unknown field / Unknown type /
 *   Variable … of type) e, dentro dele, apenas identificadores que existem no
 *   nosso próprio documento. Qualquer outra coisa vira
 *   `MENSAGEM_OMITIDA (tamanho=N)`. App ID, Secret e valor de cabeçalho nunca
 *   podem aparecer, porque nada além do modelo e desses identificadores é
 *   impresso (há um cinto extra caso um identificador coincida com um segredo).
 * - Estado do corpo é lido em stream com teto (`readBodyLimited`), como no
 *   `ShopeeClient`; passou do teto, vira `BODY_TOO_LARGE`.
 * - Relógio: horário local e cabeçalho `Date` viram UTC + diferença em segundos
 *   (§4.5); `Date` fora do formato RFC 1123 vira `ausente`.
 * - O endpoint passa por allowlist antes de qualquer envio (o Secret nunca vai
 *   para host fora de `*.shopee.com.br`, exceto loopback do servidor simulado).
 */

export const DEGRAU_D0 = "D0";
/** Rótulo de recusa local: nenhum degrau foi executado. */
export const DEGRAU_NENHUM = "-";
/** D0: só o tipo da raiz, corpo apenas com `query` (§3). */
export const D0_QUERY = "{ __typename }";

export const DIAG_OK_CODE = "OK";
export const DIAG_CODE_WITHOUT = "ERRO";
export const INVALID_CODE = "CODIGO_INVALIDO";
export const INVALID_JSON_CODE = "INVALID_JSON";
export const BODY_TOO_LARGE_CODE = "BODY_TOO_LARGE";
export const NO_DATA_CODE = "SEM_DADOS";
export const MESSAGE_OMITTED = "MENSAGEM_OMITIDA";
export const ABSENT = "ausente";
export const UNAVAILABLE = "indisponivel";

export const MAX_MESSAGE_CHARS = 120;
export const MAX_BODY_BYTES = 64 * 1024;

/** Mesma allowlist de código da sonda do PR #41. */
const SAFE_CODE = /^[A-Za-z0-9_-]{1,32}$/;
/** `Date` de resposta HTTP: RFC 1123 estrito, sem texto extra. */
const HTTP_DATE = /^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/;
const IDENTIFIER = /[A-Za-z_][A-Za-z0-9_]*/g;

/**
 * Modelos de erro GraphQL que podem ser impressos, com o texto que os rotula.
 * O que não casa com nenhum deles não é impresso (`MENSAGEM_OMITIDA`).
 */
const MESSAGE_MODELS: { label: string; match: RegExp }[] = [
  { label: "Syntax Error", match: /^Syntax Error\b/ },
  { label: "Unknown argument", match: /^Unknown argument\b/ },
  { label: "Unknown field", match: /^Unknown field\b/ },
  { label: "Unknown type", match: /^Unknown type\b/ },
  { label: "Variable of type", match: /^Variable\b.*\bof type\b/ },
];

/**
 * Identificadores do **nosso** documento (operações, argumentos, campos e tipos
 * escalares usados em `packages/shopee/src/client.ts` + a sonda D0). Só eles
 * podem sair junto do modelo; se o cliente mudar, o que sobrar é omitido (falha
 * fechada). `type`, `field`, `on` e palavras do inglês ficam de fora de propósito.
 */
const DOCUMENT_IDENTIFIERS = new Set([
  // meta e operações
  "__typename", "query", "mutation", "ProductOfferV2", "productOfferV2",
  "GenerateShortLink", "generateShortLink", "ConversionReport", "conversionReport",
  // productOfferV2: argumentos e paginação
  "keyword", "shopId", "itemId", "listType", "sortType", "page", "limit",
  "isAMSOffer", "isKeySeller", "nodes", "pageInfo", "hasNextPage",
  // productOfferV2: campos do nó
  "productName", "productLink", "offerLink", "imageUrl", "priceMin", "priceMax",
  "priceDiscountRate", "sales", "ratingStar", "commissionRate", "sellerCommissionRate",
  "shopeeCommissionRate", "commission", "shopName", "shopType", "periodStartTime",
  "periodEndTime",
  // generateShortLink
  "input", "originUrl", "subIds", "shortLink",
  // conversionReport
  "purchaseTimeStart", "purchaseTimeEnd", "orderStatus", "buyerType", "device",
  "scrollId", "purchaseTime", "clickTime", "conversionId", "totalCommission",
  "sellerCommission", "shopeeCommissionCapped", "utmContent", "orders", "orderId",
  "items", "itemName", "itemPrice", "qty", "itemTotalCommission", "attributionType",
  // tipos escalares citados nas mensagens da API
  "Int", "String", "Boolean", "Float", "ID",
]);

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

function toPrintableAscii(value: string): string {
  let text = "";
  for (const char of value) {
    const point = char.codePointAt(0) ?? 0;
    text += point >= 0x20 && point <= 0x7e ? char : " ";
  }
  return text.replace(/\s+/g, " ").trim();
}

function omitted(message: string): string {
  return `${MESSAGE_OMITTED} (tamanho=${[...message].length})`;
}

/**
 * §4.4: a mensagem é opcional e passa por allowlist. Só o modelo fixo e
 * identificadores do nosso documento saem; o resto é `MENSAGEM_OMITIDA` com o
 * tamanho original. `null` quando não há mensagem (o relatório imprime
 * `ausente`).
 */
export function sanitizeDiagMessage(message: unknown, secrets: readonly string[] = []): string | null {
  if (typeof message !== "string" || message.length === 0) return null;

  const flat = toPrintableAscii(message);
  const model = MESSAGE_MODELS.find((candidate) => candidate.match.test(flat));
  if (!model) return omitted(message);

  const identifiers = [
    ...new Set(Array.from(flat.matchAll(IDENTIFIER), (match) => match[0])),
  ].filter((token) => DOCUMENT_IDENTIFIERS.has(token));
  let text = identifiers.length > 0 ? `${model.label}: ${identifiers.join(",")}` : model.label;

  // Cinto extra: um identificador nosso jamais deve coincidir com um segredo.
  if (secrets.some((secret) => secret.length >= 4 && text.includes(secret))) {
    return omitted(message);
  }

  if (text.length > MAX_MESSAGE_CHARS) {
    text = `${text.slice(0, MAX_MESSAGE_CHARS).trimEnd()}...`;
  }
  return text;
}

export type DiagBodyRead = { text: string } | { tooLarge: true };

/**
 * Leitura em stream com teto: cancela o stream ao estourar (mesma técnica do
 * `ShopeeClient.readBodyLimited`), então um servidor que envia lixo sem parar
 * não enche a memória. `abort` corta a leitura mesmo que o corpo nunca chegue
 * (o stream não observa o signal do fetch).
 */
export async function readBodyLimited(
  response: Response,
  maxBytes: number = MAX_BODY_BYTES,
  abort?: Promise<never>,
): Promise<DiagBodyRead> {
  const race = <T,>(value: Promise<T>): Promise<T> => (abort ? Promise.race([value, abort]) : value);
  const body = response.body;
  if (!body) {
    const text = await race(response.text());
    return Buffer.byteLength(text) > maxBytes ? { tooLarge: true } : { text };
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const step = await race(reader.read());
      if (step.done) break;
      total += step.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { tooLarge: true };
      }
      chunks.push(step.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  return { text: Buffer.concat(chunks).toString("utf8") };
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
  /** O chamador já sabe que o corpo passou do teto (o stream foi cortado). */
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

  // Redirect não seguido (`redirect: "manual"`): nada de segunda requisição.
  if (input.status >= 300 && input.status < 400) {
    return { ...base, codigo: `HTTP_${input.status}`, mensagem: null };
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

export const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * Relatório de recusa/falha sem resposta. `degrau` fica em `-` quando nada foi
 * enviado (recusa local) e no degrau tentado quando a chamada saiu (§4.7).
 */
export function refusalReport(
  codigo: string,
  startedAtMs: number,
  degrau: string = DEGRAU_NENHUM,
): DiagReport {
  const localMs = Date.now();
  return {
    degrau,
    codigo,
    contagem: 0,
    duracao_ms: Math.max(0, Math.round(localMs - startedAtMs)),
    mensagem: null,
    ...diagClock(null, localMs),
  };
}

export type DiagRunInput = {
  endpoint: string | URL;
  headers: Record<string, string>;
  body: string;
  secrets: readonly string[];
  degrau?: string;
  timeoutMs?: number;
  maxBodyBytes?: number;
  fetchImpl?: typeof fetch;
};

export type DiagRunResult = { report: DiagReport; exit: number };

/**
 * A chamada inteira, com as proteções do §4.7 em um lugar só (e testável com
 * `fetchImpl` injetado): POST assinado, `redirect: "manual"`, teto de tempo
 * cobrindo resposta *e* leitura do corpo, teto de corpo em stream. Uma
 * invocação = no máximo uma requisição; nada de laço ou retry.
 *
 * `exit` 0 = resposta resumida; 1 = sem resposta (transporte/tempo).
 */
export async function diagRun(input: DiagRunInput): Promise<DiagRunResult> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = input.maxBodyBytes ?? MAX_BODY_BYTES;
  const fetchImpl = input.fetchImpl ?? fetch;
  const degrau = input.degrau ?? DEGRAU_D0;
  const startedAtMs = Date.now();

  const controller = new AbortController();
  let timedOut = false;
  let onTimeout!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    onTimeout = () => {
      timedOut = true;
      controller.abort();
      reject(new Error("diagnostic timeout"));
    };
  });
  aborted.catch(() => undefined);
  const timer = setTimeout(onTimeout, timeoutMs);

  try {
    let response: Response;
    try {
      response = await Promise.race([
        fetchImpl(input.endpoint, {
          method: "POST",
          headers: input.headers,
          body: input.body,
          // Sem seguir redirect: a allowlist de host vale só para o primeiro alvo.
          redirect: "manual",
          signal: controller.signal,
        }),
        aborted,
      ]);
    } catch {
      return { report: refusalReport(timedOut ? "TIMEOUT" : "NETWORK", startedAtMs, degrau), exit: 1 };
    }

    // Momento local logo após os cabeçalhos: é o que se compara com o `Date`.
    const localMs = Date.now();
    const dateHeader = response.headers.get("date");

    let read: DiagBodyRead;
    try {
      read = await readBodyLimited(response, maxBytes, aborted);
    } catch {
      return { report: refusalReport(timedOut ? "TIMEOUT" : "NETWORK", startedAtMs, degrau), exit: 1 };
    }

    return {
      report: summarizeDiag({
        degrau,
        status: response.status,
        ok: response.ok,
        bodyText: "text" in read ? read.text : "",
        bodyTooLarge: "tooLarge" in read,
        dateHeader,
        localMs,
        startedAtMs,
        secrets: input.secrets,
      }),
      exit: 0,
    };
  } finally {
    clearTimeout(timer);
  }
}
