import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ShopeeClient, createShopeeClient } from "../index.js";
import { ShopeeSchemaError, ShopeeSignatureError, ShopeeTimeoutError } from "../index.js";
import { startMockShopeeServer } from "../mock-server/index.js";

const APP_ID = "test-app-id";
const SECRET = "test-secret";

describe("ShopeeClient against mock server", () => {
  let server: Awaited<ReturnType<typeof startMockShopeeServer>>;

  beforeEach(async () => {
    server = await startMockShopeeServer({ appId: APP_ID, secret: SECRET });
  });

  afterEach(async () => {
    await server.close();
  });

  it("productOfferV2 validates and returns fixture data", async () => {
    const client = createShopeeClient({ appId: APP_ID, secret: SECRET }, { endpoint: server.url });
    const result = await client.productOfferV2({ keyword: "teste" });
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]!.itemId).toBe(900001);
    expect(result.pageInfo.hasNextPage).toBe(false);
  });

  it("generateShortLink returns a short link and enforces subIds max 5", async () => {
    const client = new ShopeeClient({ appId: APP_ID, secret: SECRET }, { endpoint: server.url });
    const result = await client.generateShortLink({
      originUrl: "https://shopee.com.br/produto-teste-i.1.900001",
      subIds: ["conta", "automacao", "grupo", "canal", "envio"],
    });
    expect(result.shortLink).toBe("https://shope.ee/mockshort1");

    await expect(
      client.generateShortLink({
        originUrl: "https://shopee.com.br/produto-teste-i.1.900001",
        subIds: ["a", "b", "c", "d", "e", "f"],
      }),
    ).rejects.toBeInstanceOf(ShopeeSchemaError);
  });

  it("conversionReport returns nodes and pageInfo", async () => {
    const client = createShopeeClient({ appId: APP_ID, secret: SECRET }, { endpoint: server.url });
    const result = await client.conversionReport({ orderStatus: "COMPLETED" });
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]!.conversionId).toBe("conv-mock-1");
    expect(result.pageInfo.scrollId).toBe("scroll-mock-1");
  });

  it("raises ShopeeSignatureError on invalid signature", async () => {
    const client = createShopeeClient(
      { appId: APP_ID, secret: "wrong-secret" },
      { endpoint: server.url },
    );
    await expect(client.productOfferV2()).rejects.toBeInstanceOf(ShopeeSignatureError);
  });

  it("raises ShopeeSchemaError when a response field is missing", async () => {
    const badClient = new ShopeeClient(
      { appId: APP_ID, secret: SECRET },
      {
        endpoint: server.url,
        fetch: async () =>
          new Response(
            JSON.stringify({ data: { productOfferV2: { pageInfo: { limit: 20, hasNextPage: false } } } }),
          ),
      },
    );
    await expect(badClient.productOfferV2()).rejects.toBeInstanceOf(ShopeeSchemaError);
  });

  it("raises ShopeeTimeoutError when the response body stalls", async () => {
    const client = new ShopeeClient(
      { appId: APP_ID, secret: SECRET },
      {
        endpoint: "http://127.0.0.1:1/graphql",
        timeoutMs: 50,
        fetch: (async (_url: unknown, init?: { signal?: AbortSignal }) => {
          const signal = init?.signal;
          return {
            ok: true,
            status: 200,
            text: () =>
              new Promise((_resolve, reject) => {
                signal?.addEventListener(
                  "abort",
                  () => reject(new DOMException("aborted", "AbortError")),
                  { once: true },
                );
              }),
          } as Response;
        }) as unknown as typeof fetch,
      },
    );
    await expect(client.productOfferV2()).rejects.toBeInstanceOf(ShopeeTimeoutError);
  }, 2000);
});
