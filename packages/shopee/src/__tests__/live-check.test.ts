import { describe, expect, it } from "vitest";

import { createShopeeClient } from "../client.js";
import {
  ShopeeError,
  ShopeeGraphQLError,
  ShopeeHttpError,
  ShopeeNetworkError,
  ShopeeSignatureError,
  ShopeeTimeoutError,
} from "../errors.js";
import {
  ERROR_WITHOUT_CODE,
  UNKNOWN_ERROR_CODE,
  formatLiveCheck,
  runOfferLiveCheck,
} from "../live-check.js";
import type { OfferLiveCheckClient } from "../live-check.js";
import { startMockShopeeServer } from "../mock-server/index.js";

const APP_ID = "live-check-app-id";
const SECRET = "live-check-secret";

/** Cliente falso que só falha: testa a classificação sem rede. */
function failingClient(error: unknown): OfferLiveCheckClient {
  return {
    productOfferV2: async () => {
      throw error;
    },
  };
}

describe("runOfferLiveCheck", () => {
  it("faz uma única consulta somente-leitura e conta as ofertas recebidas", async () => {
    const server = await startMockShopeeServer({ appId: APP_ID, secret: SECRET });
    try {
      const bodies: string[] = [];
      const fetchImpl: typeof fetch = async (input, init) => {
        bodies.push(typeof init?.body === "string" ? init.body : "");
        return globalThis.fetch(input, init);
      };
      const client = createShopeeClient(
        { appId: APP_ID, secret: SECRET },
        { endpoint: server.url, fetch: fetchImpl },
      );

      const result = await runOfferLiveCheck(client);

      expect(result).toEqual({ resultado: "sucesso", codigo: "OK", contagem: 1 });
      expect(bodies).toHaveLength(1);
      const body = JSON.parse(bodies[0]!) as { query: string; variables: unknown };
      expect(body.query).toContain("productOfferV2");
      expect(body.query).not.toContain("mutation");
      expect(body.variables).toEqual({ limit: 1 });
    } finally {
      await server.close();
    }
  });

  it("classifica a recusa de assinatura com o código devolvido pela Shopee", async () => {
    const server = await startMockShopeeServer({ appId: APP_ID, secret: SECRET });
    try {
      const client = createShopeeClient(
        { appId: APP_ID, secret: "secret-errado" },
        { endpoint: server.url },
      );

      const result = await runOfferLiveCheck(client);

      expect(result).toEqual({ resultado: "falha", codigo: "10020", contagem: 0 });
    } finally {
      await server.close();
    }
  });

  it("expõe o status HTTP quando a recusa vem em resposta não-2xx", async () => {
    const result = await runOfferLiveCheck(failingClient(new ShopeeHttpError(403)));

    expect(result).toEqual({ resultado: "falha", codigo: "HTTP_403", contagem: 0 });
  });

  it("expõe o código de erros transitórios (rede, timeout, schema, GraphQL)", async () => {
    const cases: { error: unknown; codigo: string }[] = [
      { error: new ShopeeNetworkError("network error (TypeError)", "NETWORK"), codigo: "NETWORK" },
      { error: new ShopeeTimeoutError("Shopee request timed out", "TIMEOUT"), codigo: "TIMEOUT" },
      { error: new ShopeeSignatureError("sig", "SIGNATURE"), codigo: "SIGNATURE" },
      { error: new ShopeeGraphQLError("graphql", "GRAPHQL"), codigo: "GRAPHQL" },
      { error: new ShopeeError("sem código"), codigo: ERROR_WITHOUT_CODE },
    ];

    for (const { error, codigo } of cases) {
      await expect(runOfferLiveCheck(failingClient(error))).resolves.toEqual({
        resultado: "falha",
        codigo,
        contagem: 0,
      });
    }
  });

  it("não propaga erro desconhecido nem a mensagem original", async () => {
    const result = await runOfferLiveCheck(failingClient(new Error(`vazou ${SECRET}`)));

    expect(result.codigo).toBe(UNKNOWN_ERROR_CODE);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("nunca inclui credencial ou texto do erro no relatório impresso", async () => {
    const result = await runOfferLiveCheck(
      failingClient(new ShopeeSignatureError(`leak ${APP_ID} ${SECRET}`, "10020")),
    );
    const printed = formatLiveCheck(result);

    expect(printed).toBe("resultado=falha\ncodigo=10020\ncontagem=0");
    for (const sensitive of [APP_ID, SECRET, "Signature", "Credential", "SHA256"]) {
      expect(printed).not.toContain(sensitive);
    }
  });

  it("formata o sucesso em exatamente três linhas", () => {
    expect(formatLiveCheck({ resultado: "sucesso", codigo: "OK", contagem: 1 })).toBe(
      "resultado=sucesso\ncodigo=OK\ncontagem=1",
    );
  });
});
