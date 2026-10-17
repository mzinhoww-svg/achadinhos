import { createHash } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLogger, type Logger } from "../../src/logger.js";
import type { FetchedImage, ImageFetcher, RenderCreative, ShortLinker } from "../../src/gerar/ports.js";

/** PNG mínimo válido (assinatura + IHDR 1x1): passa na validação de assinatura do FileOutbox. */
export const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0,
]);

export interface OfferNode {
  itemId: number;
  productName: string;
  productLink: string;
  offerLink: string;
  imageUrl: string;
  priceMin: number;
  priceMax: number;
  priceDiscountRate: number;
  sales: number;
  ratingStar: number;
  commissionRate: string | number;
  sellerCommissionRate: string | number;
  shopeeCommissionRate: string | number;
  commission: string | number;
  shopId: number;
  shopName: string;
  shopType: number;
  periodStartTime: number;
  periodEndTime: number;
}

export function offerNode(itemId: number, overrides: Partial<OfferNode> = {}): OfferNode {
  return {
    itemId,
    productName: `Produto ${itemId}`,
    productLink: `https://shopee.com.br/produto-i.1.${itemId}`,
    offerLink: `https://shopee.com.br/produto-i.1.${itemId}?af=sim`,
    imageUrl: `https://img.test/p/${itemId}.png`,
    priceMin: 19.9,
    priceMax: 29.9,
    priceDiscountRate: 33,
    sales: 120,
    ratingStar: 4.7,
    commissionRate: 0.12,
    sellerCommissionRate: 0.07,
    shopeeCommissionRate: 0.05,
    commission: 2.4,
    shopId: 5001,
    shopName: "Loja Teste",
    shopType: 2,
    periodStartTime: 1_700_000_000,
    periodEndTime: 1_700_086_400,
    ...overrides,
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function headerValue(header: string | undefined, key: string): string | undefined {
  return header ? new RegExp(`${key}=([^,]+)`).exec(header)?.[1] : undefined;
}

export interface OffersServerOptions {
  nodes: OfferNode[];
  shortLink?: string;
  hasNextPage?: boolean;
  appId?: string;
  secret?: string;
}

export interface OffersServerHandle {
  url: string;
  close: () => Promise<void>;
}

/** Servidor GraphQL simulado da Shopee: valida a assinatura e devolve os nós/shortLink configurados. */
export async function startOffersServer(options: OffersServerOptions): Promise<OffersServerHandle> {
  const appId = options.appId ?? "test-app-id";
  const secret = options.secret ?? "test-secret";
  const shortLink = options.shortLink ?? "https://shope.ee/sim123";

  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const timestamp = headerValue(request.headers.authorization, "Timestamp");
      const signature = headerValue(request.headers.authorization, "Signature");
      const ok = Boolean(timestamp && signature) && sha256(`${appId}${timestamp}${body}${secret}`) === signature;
      response.setHeader("Content-Type", "application/json");
      if (!ok) {
        response.end(JSON.stringify({ errors: [{ message: "Invalid Signature", extensions: { code: 10020 } }] }));
        return;
      }
      const query = (JSON.parse(body || "{}") as { query?: string }).query ?? "";
      if (query.includes("generateShortLink")) {
        response.end(JSON.stringify({ data: { generateShortLink: { shortLink } } }));
        return;
      }
      response.end(
        JSON.stringify({
          data: {
            productOfferV2: {
              nodes: options.nodes,
              pageInfo: { limit: 50, hasNextPage: options.hasNextPage ?? false },
            },
          },
        }),
      );
    });
    request.on("error", () => response.end());
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
    server.on("error", reject);
  });
  return {
    url: `http://127.0.0.1:${port}/graphql`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export function collectLogger(secrets: readonly string[] = []): { logger: Logger; lines: string[] } {
  const lines: string[] = [];
  const logger = createLogger({ sink: (line) => lines.push(line), level: "debug", secrets });
  return { logger, lines };
}

export function imageOf(): FetchedImage {
  return { bytes: PNG, mime: "image/png" };
}

export function fakeImageFetcher(): ImageFetcher {
  return async () => imageOf();
}

export function fakeRenderCreative(): RenderCreative {
  return async () => PNG;
}

export function fakeShortLinker(shortLink = "https://shope.ee/sim123"): ShortLinker {
  return { generateShortLink: async () => ({ shortLink }) };
}

const roots: string[] = [];
export async function tmpRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "achadinhos-gerar-"));
  roots.push(dir);
  return dir;
}

export async function cleanupRoots(): Promise<void> {
  await Promise.all(roots.map((dir) => rm(dir, { recursive: true, force: true })));
  roots.length = 0;
}
