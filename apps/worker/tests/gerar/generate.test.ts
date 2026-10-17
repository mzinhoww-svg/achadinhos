import { afterAll, describe, expect, it } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { createFileOutbox } from "@achadinhos/channel";
import { ShopeeClient, ShopeeHttpError } from "@achadinhos/shopee";

import { ImageRejectedError } from "../../src/image.js";
import { clampLimit, exitCodeFor, generateOutbox, type GenerateDeps, type GenerateInput } from "../../src/gerar/generate.js";
import {
  PNG,
  cleanupRoots,
  collectLogger,
  fakeImageFetcher,
  fakeRenderCreative,
  fakeShortLinker,
  offerNode,
  startOffersServer,
  tmpRoot,
} from "./helpers.js";

afterAll(cleanupRoots);

const RUN_STARTED_AT = new Date("2026-10-16T18:32:00.000Z"); // 14:32 em America/Cuiaba
const APP_ID = "test-app-id";
const SECRET = "test-secret";

function makeInput(overrides: Partial<GenerateInput> = {}): GenerateInput {
  return {
    runStartedAt: RUN_STARTED_AT,
    group: { index: 1, label: "Grupo 1" },
    affiliateHandle: "@afiliado",
    imageHosts: ["img.test"],
    ...overrides,
  };
}

async function harness(overrides: Partial<GenerateDeps> = {}): Promise<{ outbox: string; deps: GenerateDeps; lines: string[] }> {
  const outbox = await tmpRoot();
  const { logger, lines } = collectLogger();
  return {
    outbox,
    lines,
    deps: {
      source: { productOfferV2: async () => ({ nodes: [], pageInfo: { hasNextPage: false } }) },
      shortLinker: fakeShortLinker(),
      fetchImage: fakeImageFetcher(),
      renderCreative: fakeRenderCreative(),
      channel: createFileOutbox({ dir: outbox }),
      logger,
      ...overrides,
    },
  };
}

function clientFor(endpoint: string, secret = SECRET): ShopeeClient {
  return new ShopeeClient({ appId: APP_ID, secret }, { endpoint });
}

describe("generateOutbox (T7-B, §3)", () => {
  it("e2e com Shopee simulada: N ofertas → N pares .md/.png + index.md", async () => {
    const server = await startOffersServer({ nodes: [offerNode(11), offerNode(22), offerNode(33)] });
    try {
      const client = clientFor(server.url);
      const { outbox, deps } = await harness({ source: client, shortLinker: client });

      const summary = await generateOutbox(makeInput(), deps);

      expect(summary.delivered).toBe(3);
      expect(summary.failed).toBe(0);
      expect(summary.unknown).toBe(0);
      expect(summary.slot).toEqual({ day: "20261016", hhmm: "1432", groupIndex: 1 });
      expect(exitCodeFor(summary)).toBe(0);

      const dayDir = join(outbox, "20261016");
      expect((await readdir(dayDir)).sort()).toEqual(
        [
          "1432-11-g1.md",
          "1432-11-g1.png",
          "1432-22-g1.md",
          "1432-22-g1.png",
          "1432-33-g1.md",
          "1432-33-g1.png",
          "index.md",
        ].sort(),
      );
      const md = await readFile(join(dayDir, "1432-11-g1.md"), "utf8");
      expect(md).toContain('"generatedAtUtc":"2026-10-16T18:32:00.000Z"');
      expect(md).toContain("https://shope.ee/sim123");
    } finally {
      await server.close();
    }
  });

  it("falha de imagem vira código fixo e não derruba as outras", async () => {
    const server = await startOffersServer({ nodes: [offerNode(11), offerNode(22), offerNode(33)] });
    try {
      const client = clientFor(server.url);
      let calls = 0;
      const fetchImage = async (url: string) => {
        calls += 1;
        if (url.includes("/22.")) throw new ImageRejectedError("host");
        return { bytes: PNG, mime: "image/png" };
      };
      const { deps } = await harness({ source: client, shortLinker: client, fetchImage });

      const summary = await generateOutbox(makeInput(), deps);

      expect(summary.delivered).toBe(2);
      expect(summary.failed).toBe(1);
      expect(summary.results.find((r) => r.slotKey.includes("-22-"))?.code).toBe("imagem_host");
      expect(calls).toBe(3);
      expect(exitCodeFor(summary)).toBe(1);
    } finally {
      await server.close();
    }
  });

  it("deduplica só dentro do lote (lote nunca repete item_id)", async () => {
    const server = await startOffersServer({ nodes: [offerNode(11), offerNode(11), offerNode(22)] });
    try {
      const client = clientFor(server.url);
      const { outbox, deps } = await harness({ source: client, shortLinker: client });

      const summary = await generateOutbox(makeInput(), deps);

      expect(summary.delivered).toBe(2);
      const files = await readdir(join(outbox, "20261016"));
      expect(files.filter((f) => f.endsWith(".md") && f !== "index.md")).toHaveLength(2);
    } finally {
      await server.close();
    }
  });

  it("respeita o teto por execução (--limite, máx. 50)", async () => {
    expect(clampLimit(undefined)).toBe(10);
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(999)).toBe(50);
    expect(clampLimit(3.9)).toBe(3);

    const server = await startOffersServer({
      nodes: [offerNode(1), offerNode(2), offerNode(3), offerNode(4), offerNode(5)],
    });
    try {
      const client = clientFor(server.url);
      const { deps } = await harness({ source: client, shortLinker: client });
      const summary = await generateOutbox(makeInput({ limit: 2 }), deps);
      expect(summary.limit).toBe(2);
      expect(summary.delivered).toBe(2);
      expect(summary.results).toHaveLength(2);
    } finally {
      await server.close();
    }
  });

  it("shortLink fora da allowlist → failed link_invalido", async () => {
    const server = await startOffersServer({ nodes: [offerNode(11)], shortLink: "https://evil.example.com/x" });
    try {
      const client = clientFor(server.url);
      const { deps } = await harness({ source: client, shortLinker: client });
      const summary = await generateOutbox(makeInput(), deps);
      expect(summary.failed).toBe(1);
      expect(summary.results[0]?.code).toBe("link_invalido");
    } finally {
      await server.close();
    }
  });

  it("falha do criativo → failed criativo_falhou, sem retry", async () => {
    const server = await startOffersServer({ nodes: [offerNode(11)] });
    try {
      const client = clientFor(server.url);
      let renderCalls = 0;
      const renderCreative = async () => {
        renderCalls += 1;
        throw new Error("boom (mensagem que não pode vazar)");
      };
      const { deps } = await harness({ source: client, shortLinker: client, renderCreative });
      const summary = await generateOutbox(makeInput(), deps);
      expect(summary.results[0]?.code).toBe("criativo_falhou");
      expect(renderCalls).toBe(1);
      expect(exitCodeFor(summary)).toBe(1);
    } finally {
      await server.close();
    }
  });

  it("falha na busca vira fetchError e exit 1, sem logar a mensagem original", async () => {
    const { deps, lines } = await harness({
      source: {
        productOfferV2: async () => {
          throw new ShopeeHttpError(500);
        },
      },
    });
    const summary = await generateOutbox(makeInput(), deps);
    expect(summary.fetchError).toBe("shopee_http");
    expect(summary.results).toEqual([]);
    expect(exitCodeFor(summary)).toBe(1);
    expect(lines.join("\n")).toContain("busca_falhou");
  });

  it("exit code: 0 só quando nada falha; 1 com failed/unknown/fetchError", () => {
    const base = {
      slot: { day: "20261016", hhmm: "1432", groupIndex: 1 },
      limit: 10,
      results: [],
      delivered: 0,
      failed: 0,
      unknown: 0,
      discarded: 0,
    };
    expect(exitCodeFor(base)).toBe(0);
    expect(exitCodeFor({ ...base, failed: 1 })).toBe(1);
    expect(exitCodeFor({ ...base, unknown: 1 })).toBe(1);
    expect(exitCodeFor({ ...base, fetchError: "shopee_http" })).toBe(1);
  });

  it("conta descartes e avisa quando nada é utilizável (host de imagem fora da allowlist)", async () => {
    const server = await startOffersServer({ nodes: [offerNode(11, { imageUrl: "https://fora.test/x.png" })] });
    try {
      const client = clientFor(server.url);
      const { deps, lines } = await harness({ source: client, shortLinker: client });
      const summary = await generateOutbox(makeInput(), deps);
      expect(summary.discarded).toBe(1);
      expect(summary.delivered).toBe(0);
      expect(lines.join("\n")).toContain("sem_ofertas_utilizaveis");
    } finally {
      await server.close();
    }
  });

  it("nenhum arquivo nem linha de log contém o Secret", async () => {
    const secret = "segredo-super-secreto-123";
    const server = await startOffersServer({ nodes: [offerNode(11)], secret });
    try {
      const client = clientFor(server.url, secret);
      const outbox = await tmpRoot();
      const { logger, lines } = collectLogger([secret]);
      logger.info("debug", { secret }); // prova que a redação atua no caminho de log

      const summary = await generateOutbox(makeInput(), {
        source: client,
        shortLinker: client,
        fetchImage: fakeImageFetcher(),
        renderCreative: fakeRenderCreative(),
        channel: createFileOutbox({ dir: outbox }),
        logger,
      });

      expect(summary.delivered).toBe(1);
      expect(client.toJSON().secret).toBe("[REDACTED]");
      expect(lines.join("\n")).not.toContain(secret);
      expect(lines.join("\n")).toContain("[REDACTED]");
      for (const file of await readdir(join(outbox, "20261016"))) {
        const content = await readFile(join(outbox, "20261016", file), "utf8").catch(() => "");
        expect(content).not.toContain(secret);
      }
    } finally {
      await server.close();
    }
  });
});
