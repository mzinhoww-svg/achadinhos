import http from "node:http";

import productFixture from "./fixtures/productOfferV2.json" with { type: "json" };
import shortLinkFixture from "./fixtures/generateShortLink.json" with { type: "json" };
import conversionFixture from "./fixtures/conversionReport.json" with { type: "json" };
import { createHash } from "node:crypto";

export type MockShopeeServerOptions = {
  appId?: string;
  secret?: string;
  port?: number;
};

export type MockShopeeServerHandle = {
  url: string;
  port: number;
  close: () => Promise<void>;
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function readBody(request: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function parseHeaderValue(header: string | undefined, key: string): string | undefined {
  if (!header) return undefined;
  const match = header.match(new RegExp(`${key}=([^,]+)`));
  return match?.[1];
}

function chooseFixture(query: string): unknown {
  if (query.includes("generateShortLink")) return shortLinkFixture;
  if (query.includes("conversionReport")) return conversionFixture;
  return productFixture;
}

export function createMockShopeeServer(options: MockShopeeServerOptions = {}) {
  const appId = options.appId ?? "test-app-id";
  const secret = options.secret ?? "test-secret";

  const server = http.createServer(async (request, response) => {
    if (request.method !== "POST") {
      response.statusCode = 405;
      response.end(JSON.stringify({ errors: [{ message: "method not allowed" }] }));
      return;
    }

    const body = await readBody(request);

    let query = "";
    try {
      const parsed = JSON.parse(body || "{}") as { query?: string };
      query = typeof parsed.query === "string" ? parsed.query : "";
    } catch {
      query = "";
    }

    const authorization = request.headers.authorization;
    let signatureValid = true;
    try {
      const timestamp = parseHeaderValue(authorization, "Timestamp");
      const signature = parseHeaderValue(authorization, "Signature");
      if (!timestamp || !signature) {
        signatureValid = false;
      } else {
        const expected = sha256(`${appId}${timestamp}${body}${secret}`);
        signatureValid = expected === signature;
      }
    } catch {
      signatureValid = false;
    }

    response.setHeader("Content-Type", "application/json");
    if (!signatureValid) {
      response.statusCode = 200;
      response.end(
        JSON.stringify({
          errors: [{ message: "Invalid Signature", extensions: { code: 10020 } }],
        }),
      );
      return;
    }

    response.statusCode = 200;
    response.end(JSON.stringify(chooseFixture(query)));
  });

  return server;
}

export async function startMockShopeeServer(
  options: MockShopeeServerOptions = {},
): Promise<MockShopeeServerHandle> {
  const server = createMockShopeeServer(options);

  const port = await new Promise<number>((resolve, reject) => {
    server.listen(options.port ?? 0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("could not determine server port"));
        return;
      }
      resolve(address.port);
    });
    server.on("error", reject);
  });

  return {
    url: `http://127.0.0.1:${port}/graphql`,
    port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}
