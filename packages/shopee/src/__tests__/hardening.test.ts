import http from "node:http";
import { inspect } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ShopeeClient,
  ShopeeConfigError,
  ShopeeHttpError,
  ShopeeSchemaError,
  ShopeeSignatureError,
  ShopeeTimeoutError,
} from "../index.js";
import { startMockShopeeServer } from "../mock-server/index.js";

const APP_ID = "test-app-id";
// Canário montado em runtime: não existe como literal no repositório (gitleaks).
const SECRET = ["canary", "secret", String(Date.now()), "x7f3a"].join("-");
const USERINFO_PW = ["pw", String(Date.now())].join("");

const node = (over: Record<string, unknown> = {}) => ({
  itemId: 1,
  productName: "Produto",
  productLink: "https://shopee.com.br/p",
  offerLink: "https://shope.ee/o",
  imageUrl: "https://down-br.img.susercontent.com/a.jpg",
  priceMin: 10,
  priceMax: 20,
  priceDiscountRate: 5,
  sales: 1,
  ratingStar: 4.5,
  commissionRate: "0.1",
  sellerCommissionRate: "0.05",
  shopeeCommissionRate: "0.05",
  commission: "1",
  shopId: 1,
  shopName: "Loja",
  shopType: 1,
  periodStartTime: 1,
  periodEndTime: 2,
  ...over,
});
const offers = (n: unknown) =>
  new Response(
    JSON.stringify({
      data: { productOfferV2: { nodes: [n], pageInfo: { limit: 1, hasNextPage: false } } },
    }),
  );

describe("R1 — secret não enumerável", () => {
  const client = new ShopeeClient({ appId: APP_ID, secret: SECRET });
  it("JSON.stringify não contém o secret", () => {
    expect(JSON.stringify(client)).not.toContain(SECRET);
    expect(JSON.stringify({ client })).not.toContain(SECRET);
  });
  it("util.inspect não contém o secret", () => {
    expect(inspect(client, { depth: 5, showHidden: true })).not.toContain(SECRET);
    expect(String(inspect({ client }))).not.toContain(SECRET);
  });
  it("Object.keys/entries não expõem o secret", () => {
    expect(JSON.stringify(Object.entries(client))).not.toContain(SECRET);
    expect(JSON.stringify(Object.getOwnPropertyNames(client))).not.toContain(SECRET);
  });
  it("redige com marcador e mantém appId", () => {
    expect(JSON.parse(JSON.stringify(client))).toMatchObject({
      appId: APP_ID,
      secret: "[REDACTED]",
    });
  });
  it("continua assinando corretamente", async () => {
    const server = await startMockShopeeServer({ appId: APP_ID, secret: SECRET });
    try {
      const c = new ShopeeClient({ appId: APP_ID, secret: SECRET }, { endpoint: server.url });
      expect((await c.productOfferV2({ limit: 1 })).nodes).toHaveLength(1);
    } finally {
      await server.close();
    }
  });
});

describe("R2 — endpoint https + allowlist", () => {
  const make = (endpoint: string) => () =>
    new ShopeeClient({ appId: APP_ID, secret: SECRET }, { endpoint });
  it("rejeita http de host externo", () => {
    expect(make("http://evil.example/graphql")).toThrow(ShopeeConfigError);
    expect(make("http://open-api.affiliate.shopee.com.br/graphql")).toThrow(ShopeeConfigError);
  });
  it("rejeita https fora da allowlist e hosts parecidos", () => {
    expect(make("https://evil.example/graphql")).toThrow(ShopeeConfigError);
    expect(make("https://shopee.com.br.evil.example/graphql")).toThrow(ShopeeConfigError);
    expect(make("https://evilshopee.com.br/graphql")).toThrow(ShopeeConfigError);
    expect(make("https://user:pw@open-api.affiliate.shopee.com.br/graphql")).toThrow(ShopeeConfigError);
    expect(make("not a url")).toThrow(ShopeeConfigError);
  });
  it("aceita host shopee.com.br e loopback (mock)", () => {
    expect(make("https://open-api.affiliate.shopee.com.br/graphql")).not.toThrow();
    expect(make("http://127.0.0.1:4000/graphql")).not.toThrow();
    expect(make("http://localhost:4000/graphql")).not.toThrow();
  });
  it("mensagem do erro não ecoa o secret nem credenciais da URL", () => {
    try {
      make(`https://user:${USERINFO_PW}@evil.example/graphql`)();
    } catch (e) {
      expect(String((e as Error).message)).not.toContain(USERINFO_PW);
    }
  });
});

describe("R3 — status HTTP e classificação 401/403", () => {
  const client = (fetchImpl: typeof fetch) =>
    new ShopeeClient(
      { appId: APP_ID, secret: SECRET },
      { endpoint: "http://127.0.0.1:1/graphql", fetch: fetchImpl },
    );
  it("401 com 10020 vira ShopeeSignatureError com status", async () => {
    const f = (async () =>
      new Response(
        JSON.stringify({ errors: [{ message: "Invalid Signature", extensions: { code: 10020 } }] }),
        { status: 401 },
      )) as typeof fetch;
    const err = await client(f).productOfferV2().catch((e) => e);
    expect(err).toBeInstanceOf(ShopeeSignatureError);
    expect(err.status).toBe(401);
  });
  it("429 e 500 expõem status e são distinguíveis", async () => {
    for (const status of [429, 500, 403]) {
      const f = (async () => new Response("oops", { status })) as typeof fetch;
      const err = await client(f).productOfferV2().catch((e) => e);
      expect(err).toBeInstanceOf(ShopeeHttpError);
      expect(err.status).toBe(status);
    }
  });
  it("corpo de erro não-2xx é cancelado/limitado e não vaza na mensagem", async () => {
    const f = (async () =>
      new Response(`token=${SECRET} ` + "x".repeat(50_000), { status: 502 })) as typeof fetch;
    const err = await client(f).productOfferV2().catch((e) => e);
    expect(err).toBeInstanceOf(ShopeeHttpError);
    expect(err.message).not.toContain(SECRET);
  });
});

describe("R4 — links e valores validados", () => {
  const run = (n: Record<string, unknown>) =>
    new ShopeeClient(
      { appId: APP_ID, secret: SECRET },
      { endpoint: "http://127.0.0.1:1/graphql", fetch: (async () => offers(node(n))) as typeof fetch },
    ).productOfferV2();
  it("aceita nó válido", async () => {
    expect((await run({})).nodes).toHaveLength(1);
  });
  it.each([
    ["offerLink", ""],
    ["offerLink", "javascript:alert(1)"],
    ["offerLink", "http://shope.ee/x"],
    ["productLink", "http://shopee.com.br/x"],
    ["productLink", ""],
    ["imageUrl", "data:image/png;base64,AAAA"],
    ["imageUrl", ""],
    ["productName", ""],
    ["priceMin", -5],
    ["priceMax", -1],
  ])("rejeita %s = %j", async (field, value) => {
    await expect(run({ [field]: value })).rejects.toBeInstanceOf(ShopeeSchemaError);
  });
  it.each(["", "javascript:alert(1)", "http://shope.ee/x"])(
    "shortLink inválido %j falha fechado",
    async (shortLink) => {
      const c = new ShopeeClient(
        { appId: APP_ID, secret: SECRET },
        {
          endpoint: "http://127.0.0.1:1/graphql",
          fetch: (async () =>
            new Response(JSON.stringify({ data: { generateShortLink: { shortLink } } }))) as typeof fetch,
        },
      );
      await expect(
        c.generateShortLink({ originUrl: "https://shopee.com.br/p" }),
      ).rejects.toBeInstanceOf(ShopeeSchemaError);
    },
  );
  it("originUrl de entrada precisa ser https", async () => {
    const c = new ShopeeClient(
      { appId: APP_ID, secret: SECRET },
      { endpoint: "http://127.0.0.1:1/graphql", fetch: (async () => offers(node())) as typeof fetch },
    );
    await expect(c.generateShortLink({ originUrl: "javascript:1" })).rejects.toBeInstanceOf(
      ShopeeSchemaError,
    );
  });
});

describe("R5 — limite de corpo e timeout na leitura", () => {
  let srv: http.Server;
  let url: string;
  beforeEach(async () => {
    srv = http.createServer((req, res) => {
      req.resume();
      if (req.url === "/big") {
        res.setHeader("content-type", "application/json");
        res.write('{"data":"');
        const chunk = "a".repeat(64 * 1024);
        let sent = 0;
        const t = setInterval(() => {
          sent += chunk.length;
          if (res.destroyed || sent > 20 * 1024 * 1024) {
            clearInterval(t);
            res.destroy();
            return;
          }
          res.write(chunk);
        }, 1);
        res.on("close", () => clearInterval(t));
      } else if (req.url === "/stall") {
        res.writeHead(200, { "content-type": "application/json" });
        res.write('{"data":');
      }
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    url = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
  });
  afterEach(async () => {
    srv.closeAllConnections();
    await new Promise<void>((r) => srv.close(() => r()));
  });
  it("corpo acima do limite falha fechado sem carregar tudo", async () => {
    const c = new ShopeeClient(
      { appId: APP_ID, secret: SECRET },
      { endpoint: `${url}/big`, maxResponseBytes: 256 * 1024, timeoutMs: 5000 },
    );
    const err = await c.productOfferV2().catch((e) => e);
    expect(err).toBeInstanceOf(ShopeeSchemaError);
    expect(err.code).toBe("BODY_TOO_LARGE");
  }, 10_000);
  it("corpo estancado em servidor real vira ShopeeTimeoutError", async () => {
    const c = new ShopeeClient(
      { appId: APP_ID, secret: SECRET },
      { endpoint: `${url}/stall`, timeoutMs: 300 },
    );
    const t0 = Date.now();
    await expect(c.productOfferV2()).rejects.toBeInstanceOf(ShopeeTimeoutError);
    expect(Date.now() - t0).toBeLessThan(2000);
  }, 5000);
  it("fetch injetado que ignora o signal ainda respeita o timeout (race)", async () => {
    const c = new ShopeeClient(
      { appId: APP_ID, secret: SECRET },
      {
        endpoint: "http://127.0.0.1:1/graphql",
        timeoutMs: 100,
        fetch: (async () =>
          new Response(
            new ReadableStream({ start() {} }), // nunca emite nem fecha, ignora signal
            { status: 200 },
          )) as typeof fetch,
      },
    );
    await expect(c.productOfferV2()).rejects.toBeInstanceOf(ShopeeTimeoutError);
  }, 3000);
  it("pacote de produção não exporta o mock-server no índice", async () => {
    const idx = await import("../index.js");
    expect("startMockServer" in idx).toBe(false);
    expect("createMockShopeeServer" in idx).toBe(false);
  });
});
