import { createHash } from "node:crypto";
import { z } from "zod";

import {
  ConversionReportResponseSchema,
  GenerateShortLinkResponseSchema,
  ProductOfferV2ResponseSchema,
} from "./schemas.js";
import type {
  ConversionReportParams,
  GenerateShortLinkParams,
  ProductOfferV2Params,
} from "./schemas.js";
import {
  ShopeeGraphQLError,
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
};

const DEFAULT_ENDPOINT = "https://open-api.affiliate.shopee.com.br/graphql";
const DEFAULT_TIMEOUT_MS = 30_000;

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
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(
    private readonly credentials: ShopeeCredentials,
    options: ShopeeClientOptions = {},
  ) {
    this.endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? (() => Date.now());
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
    const timestamp = Math.floor(this.now() / 1000);
    const bodyObject = Object.keys(variables).length > 0 ? { query, variables } : { query };
    const body = JSON.stringify(bodyObject);

    const signature = ShopeeClient.sign(
      this.credentials.appId,
      timestamp,
      body,
      this.credentials.secret,
    );

    const headers = {
      "Content-Type": "application/json",
      Authorization: `SHA256 Credential=${this.credentials.appId}, Timestamp=${timestamp}, Signature=${signature}`,
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await abortable(
        this.fetchImpl(this.endpoint, {
          method: "POST",
          headers,
          body,
          signal: controller.signal,
        }),
        controller.signal,
      );
    } catch (error) {
      clearTimeout(timer);
      if (controller.signal.aborted) {
        throw new ShopeeTimeoutError("Shopee request timed out", "TIMEOUT");
      }
      throw new ShopeeNetworkError(
        error instanceof Error ? error.message : "network error",
        "NETWORK",
      );
    }
    if (!response.ok) {
      clearTimeout(timer);
      throw new ShopeeNetworkError(`HTTP ${response.status}`, "HTTP");
    }

    let json: unknown;
    try {
      json = await abortable(response.json(), controller.signal);
    } catch (error) {
      clearTimeout(timer);
      if (controller.signal.aborted) {
        throw new ShopeeTimeoutError("Shopee request timed out", "TIMEOUT");
      }
      throw new ShopeeSchemaError(
        error instanceof Error ? error.message : "response is not valid JSON",
        "INVALID_JSON",
      );
    }
    clearTimeout(timer);

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

/** Rejeita quando o signal aborta, mesmo que o fetch/corpo ignore o signal (timeout cobre a leitura do corpo). */
function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error("aborted"));
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
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
