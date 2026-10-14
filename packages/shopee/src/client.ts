import { createHash } from "node:crypto";
import { inspect } from "node:util";
import { z } from "zod";

import {
  ConversionReportResponseSchema,
  HttpsUrlSchema,
  GenerateShortLinkResponseSchema,
  ProductOfferV2ResponseSchema,
} from "./schemas.js";
import type {
  ConversionReportParams,
  GenerateShortLinkParams,
  ProductOfferV2Params,
} from "./schemas.js";
import {
  ShopeeConfigError,
  ShopeeGraphQLError,
  ShopeeHttpError,
  ShopeeNetworkError,
  ShopeeSchemaError,
  ShopeeSignatureError,
  ShopeeTimeoutError,
  ShopeeTimestampError,
} from "./errors.js";

export type ShopeeCredentials = {
  appId: string;
  secret: string;
};

export type ShopeeClientOptions = {
  endpoint?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
  now?: () => number;
  /** Limite do corpo da resposta, em bytes (padrão 2 MiB). */
  maxResponseBytes?: number;
};

const DEFAULT_ENDPOINT = "https://open-api.affiliate.shopee.com.br/graphql";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_ERROR_BODY_BYTES = 8 * 1024;
const ALLOWED_HOST_SUFFIX = ".shopee.com.br";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * Exige https e host em *.shopee.com.br; http só para loopback (servidor simulado).
 * A mensagem nunca ecoa a URL, que pode carregar credenciais.
 */
function validateEndpoint(endpoint: string): string {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new ShopeeConfigError("Shopee endpoint is not a valid URL", "ENDPOINT_INVALID");
  }
  if (url.username || url.password) {
    throw new ShopeeConfigError("Shopee endpoint must not embed credentials", "ENDPOINT_CREDENTIALS");
  }
  const host = url.hostname.toLowerCase();
  if (LOOPBACK_HOSTS.has(host) && (url.protocol === "http:" || url.protocol === "https:")) {
    return endpoint;
  }
  if (url.protocol !== "https:") {
    throw new ShopeeConfigError("Shopee endpoint must use https", "ENDPOINT_NOT_HTTPS");
  }
  if (!host.endsWith(ALLOWED_HOST_SUFFIX) || host.length === ALLOWED_HOST_SUFFIX.length) {
    throw new ShopeeConfigError("Shopee endpoint host is not allowed", "ENDPOINT_HOST");
  }
  return endpoint;
}

/**
 * Lê o corpo em streaming com teto de bytes; cancela o stream ao estourar.
 * `abort` rejeita a corrida mesmo que o fetch injetado ignore o signal.
 */
async function readBodyLimited(
  response: Response,
  maxBytes: number,
  abort: Promise<never>,
): Promise<{ text: string } | { tooLarge: true }> {
  const body = response.body;
  if (!body) {
    const text = await Promise.race([response.text(), abort]);
    return Buffer.byteLength(text) > maxBytes ? { tooLarge: true } : { text };
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const step = await Promise.race([reader.read(), abort]);
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

const EnvelopeSchema = z.object({
  data: z.unknown().optional(),
  errors: z
    .array(
      z.object({
        message: z.string(),
        path: z.array(z.unknown()).optional(),
        extensions: z
          .object({
            code: z.union([z.string(), z.number()]).optional(),
            message: z.string().optional(),
          })
          .optional(),
      }),
    )
    .optional(),
});

export class ShopeeClient {
  // `#` campos não aparecem em Object.keys/JSON/inspect (auditoria R1).
  readonly #credentials: ShopeeCredentials;
  readonly #endpoint: string;
  readonly #timeoutMs: number;
  readonly #fetchImpl: typeof fetch;
  readonly #now: () => number;
  readonly #maxResponseBytes: number;

  constructor(credentials: ShopeeCredentials, options: ShopeeClientOptions = {}) {
    this.#credentials = { appId: credentials.appId, secret: credentials.secret };
    this.#endpoint = validateEndpoint(options.endpoint ?? DEFAULT_ENDPOINT);
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#fetchImpl = options.fetch ?? fetch;
    this.#now = options.now ?? (() => Date.now());
    this.#maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  }

  toJSON(): { appId: string; secret: string } {
    return { appId: this.#credentials.appId, secret: "[REDACTED]" };
  }

  [inspect.custom](): string {
    return `ShopeeClient { appId: '${this.#credentials.appId}', secret: '[REDACTED]' }`;
  }

  static sign(
    appId: string,
    timestamp: string | number,
    payload: string,
    secret: string,
  ): string {
    return createHash("sha256")
      .update(`${appId}${timestamp}${payload}${secret}`)
      .digest("hex");
  }

  async productOfferV2(
    params: ProductOfferV2Params = {},
  ): Promise<z.infer<typeof ProductOfferV2ResponseSchema>["productOfferV2"]> {
    const query = `query ProductOfferV2(
      $keyword: String
      $shopId: Int
      $itemId: Int
      $listType: Int
      $sortType: Int
      $page: Int
      $limit: Int
      $isAMSOffer: Boolean
      $isKeySeller: Boolean
    ) {
      productOfferV2(
        keyword: $keyword
        shopId: $shopId
        itemId: $itemId
        listType: $listType
        sortType: $sortType
        page: $page
        limit: $limit
        isAMSOffer: $isAMSOffer
        isKeySeller: $isKeySeller
      ) {
        nodes {
          itemId
          productName
          productLink
          offerLink
          imageUrl
          priceMin
          priceMax
          priceDiscountRate
          sales
          ratingStar
          commissionRate
          sellerCommissionRate
          shopeeCommissionRate
          commission
          shopId
          shopName
          shopType
          periodStartTime
          periodEndTime
        }
        pageInfo {
          page
          limit
          hasNextPage
        }
      }
    }`;

    const data = await this.request(
      query,
      params as Record<string, unknown>,
      ProductOfferV2ResponseSchema,
    );
    return data.productOfferV2;
  }

  async generateShortLink(
    params: GenerateShortLinkParams,
  ): Promise<z.infer<typeof GenerateShortLinkResponseSchema>["generateShortLink"]> {
    if (!HttpsUrlSchema.safeParse(params.originUrl).success) {
      throw new ShopeeSchemaError("originUrl must be an https URL", "ORIGIN_URL_INVALID");
    }
    const subIds = params.subIds ?? [];
    if (subIds.length > 5) {
      throw new ShopeeSchemaError("subIds must contain at most 5 items", "SUBIDS_MAX_EXCEEDED");
    }

    const query = `mutation GenerateShortLink($originUrl: String!, $subIds: [String]) {
      generateShortLink(input: { originUrl: $originUrl, subIds: $subIds }) {
        shortLink
      }
    }`;

    const data = await this.request(
      query,
      { originUrl: params.originUrl, subIds },
      GenerateShortLinkResponseSchema,
    );
    return data.generateShortLink;
  }

  async conversionReport(
    params: ConversionReportParams = {},
  ): Promise<z.infer<typeof ConversionReportResponseSchema>["conversionReport"]> {
    const query = `query ConversionReport(
      $purchaseTimeStart: Int
      $purchaseTimeEnd: Int
      $orderStatus: String
      $buyerType: String
      $device: String
      $scrollId: String
      $limit: Int
    ) {
      conversionReport(
        purchaseTimeStart: $purchaseTimeStart
        purchaseTimeEnd: $purchaseTimeEnd
        orderStatus: $orderStatus
        buyerType: $buyerType
        device: $device
        scrollId: $scrollId
        limit: $limit
      ) {
        nodes {
          purchaseTime
          clickTime
          conversionId
          totalCommission
          sellerCommission
          shopeeCommissionCapped
          buyerType
          device
          utmContent
          orders {
            orderId
            orderStatus
            items {
              itemId
              itemName
              shopName
              itemPrice
              qty
              itemTotalCommission
              attributionType
            }
          }
        }
        pageInfo {
          limit
          hasNextPage
          scrollId
        }
      }
    }`;

    const data = await this.request(
      query,
      params as Record<string, unknown>,
      ConversionReportResponseSchema,
    );
    return data.conversionReport;
  }

  private async request<T>(
    query: string,
    variables: Record<string, unknown>,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const timestamp = Math.floor(this.#now() / 1000);
    const bodyObject = Object.keys(variables).length > 0 ? { query, variables } : { query };
    const body = JSON.stringify(bodyObject);

    const signature = ShopeeClient.sign(
      this.#credentials.appId,
      timestamp,
      body,
      this.#credentials.secret,
    );

    const headers = {
      "Content-Type": "application/json",
      Authorization: `SHA256 Credential=${this.#credentials.appId}, Timestamp=${timestamp}, Signature=${signature}`,
    };

    // Um único timer cobre headers + leitura do corpo. A corrida com `aborted`
    // garante o corte mesmo se o fetch injetado ignorar o signal.
    const controller = new AbortController();
    let onTimeout!: () => void;
    const aborted = new Promise<never>((_resolve, reject) => {
      onTimeout = () => {
        controller.abort();
        reject(new ShopeeTimeoutError("Shopee request timed out", "TIMEOUT"));
      };
    });
    aborted.catch(() => undefined);
    const timer = setTimeout(onTimeout, this.#timeoutMs);

    try {
      let response: Response;
      try {
        response = await Promise.race([
          this.#fetchImpl(this.#endpoint, {
            method: "POST",
            headers,
            body,
            signal: controller.signal,
          }),
          aborted,
        ]);
      } catch (error) {
        if (error instanceof ShopeeTimeoutError) throw error;
        if (controller.signal.aborted) {
          throw new ShopeeTimeoutError("Shopee request timed out", "TIMEOUT");
        }
        throw new ShopeeNetworkError(
          error instanceof Error ? error.message : "network error",
          "NETWORK",
        );
      }

      if (!response.ok) {
        throw await this.#httpError(response, aborted);
      }

      let read: { text: string } | { tooLarge: true };
      try {
        read = await readBodyLimited(response, this.#maxResponseBytes, aborted);
      } catch (error) {
        if (error instanceof ShopeeTimeoutError) throw error;
        if (controller.signal.aborted) {
          throw new ShopeeTimeoutError("Shopee request timed out", "TIMEOUT");
        }
        throw new ShopeeNetworkError("failed to read response body", "BODY_READ");
      }
      if ("tooLarge" in read) {
        throw new ShopeeSchemaError("response body exceeds size limit", "BODY_TOO_LARGE");
      }

      let json: unknown;
      try {
        json = JSON.parse(read.text);
      } catch {
        throw new ShopeeSchemaError("response is not valid JSON", "INVALID_JSON");
      }
      return this.#parse(json, schema);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Resposta não-2xx: lê no máximo 8 KiB para reconhecer erro de assinatura
   * (R3); o corpo nunca entra na mensagem, e o stream é cancelado (R5).
   */
  async #httpError(response: Response, abort: Promise<never>): Promise<Error> {
    const status = response.status;
    try {
      const read = await readBodyLimited(response, MAX_ERROR_BODY_BYTES, abort);
      if ("text" in read) {
        const envelope = EnvelopeSchema.safeParse(JSON.parse(read.text));
        const first = envelope.success ? envelope.data.errors?.[0] : undefined;
        if (first) {
          const code = first.extensions?.code;
          if (first.message.toLowerCase().includes("signature") || code === 10020) {
            return new ShopeeSignatureError(first.message, String(code ?? "SIGNATURE"), status);
          }
        }
      }
    } catch (error) {
      if (error instanceof ShopeeTimeoutError) return error;
    }
    await response.body?.cancel().catch(() => undefined);
    return new ShopeeHttpError(status);
  }

  #parse<T>(json: unknown, schema: z.ZodType<T>): T {
    const envelope = EnvelopeSchema.safeParse(json);
    if (!envelope.success) {
      throw new ShopeeSchemaError("response envelope is invalid", "INVALID_ENVELOPE");
    }

    if (envelope.data.errors && envelope.data.errors.length > 0) {
      const first = envelope.data.errors[0];
      if (!first) {
        throw new ShopeeSchemaError("response errors are invalid", "INVALID_ERRORS");
      }
      const code = first.extensions?.code;
      const message = first.message;
      const lower = message.toLowerCase();
      if (lower.includes("signature") || code === 10020) {
        throw new ShopeeSignatureError(message, String(code ?? "SIGNATURE"));
      }
      if (lower.includes("timestamp")) {
        throw new ShopeeTimestampError(message, String(code ?? "TIMESTAMP"));
      }
      throw new ShopeeGraphQLError(message, String(code ?? "GRAPHQL"));
    }

    const parsed = schema.safeParse(envelope.data.data);
    if (!parsed.success) {
      throw new ShopeeSchemaError("response data failed schema validation", "SCHEMA");
    }

    return parsed.data;
  }
}

export function createShopeeClient(
  credentials: ShopeeCredentials,
  options?: ShopeeClientOptions,
): ShopeeClient {
  return new ShopeeClient(credentials, options);
}


export function sign(appId: string, timestamp: string | number, payload: string, secret: string): string {
  return ShopeeClient.sign(appId, timestamp, payload, secret);
}
