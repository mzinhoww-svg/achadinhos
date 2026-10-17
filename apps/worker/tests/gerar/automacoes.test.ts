import { afterAll, describe, expect, it } from "vitest";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { createFileOutbox } from "@achadinhos/channel";
import { parseAutomationsConfig, type AutomationInput } from "@achadinhos/domain";
import { ShopeeClient } from "@achadinhos/shopee";

import {
  DEFAULT_AUTOMATIONS_FILE,
  loadAutomationsFile,
  runAutomations,
  selectDueAutomations,
} from "../../src/gerar/automacoes.js";
import {
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

const NOW = new Date("2026-10-16T18:32:00.000Z"); // sexta-feira, 14:32 em America/Cuiaba

function automation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "A",
    filters: {},
    days: [0, 1, 2, 3, 4, 5, 6],
    windowStart: "00:00",
    windowEnd: "23:59",
    frequencyMin: 30,
    timeZone: "America/Cuiaba",
    ...overrides,
  };
}

function parse(list: unknown[]): AutomationInput[] {
  const result = parseAutomationsConfig({ automacoes: list });
  if (!result.ok) throw new Error(result.code);
  return result.automations;
}

describe("loadAutomationsFile (T7-D)", () => {
  it("arquivo padrão é config/automacoes.json", () => {
    expect(DEFAULT_AUTOMATIONS_FILE).toBe("config/automacoes.json");
  });

  it("falha fechado: ausente, JSON inválido e 6ª automação", async () => {
    expect(await loadAutomationsFile("/caminho/que/nao/existe.json")).toEqual({
      ok: false,
      code: "automacoes_ausentes",
    });
    expect(await loadAutomationsFile("x", async () => "{ nao json")).toEqual({
      ok: false,
      code: "automacoes_invalidas",
    });
    const six = JSON.stringify({ automacoes: Array.from({ length: 6 }, () => automation()) });
    expect(await loadAutomationsFile("x", async () => six)).toEqual({ ok: false, code: "automacoes_limite" });
  });

  it("lê um arquivo válido", async () => {
    const raw = JSON.stringify({ automacoes: [automation({ name: "Promo" })] });
    const result = await loadAutomationsFile("x", async () => raw);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.automations[0]?.name).toBe("Promo");
  });
});

describe("selectDueAutomations", () => {
  it("filtra por janela e dias, mantendo o groupIndex do arquivo", () => {
    const list = parse([
      automation({ name: "Dia", days: [5], windowStart: "08:00", windowEnd: "22:00" }),
      automation({ name: "Segunda", days: [1], windowStart: "08:00", windowEnd: "22:00" }),
      automation({ name: "Madrugada", days: [5], windowStart: "01:00", windowEnd: "02:00" }),
      automation({ name: "Tarde", days: [5], windowStart: "14:00", windowEnd: "15:00" }),
    ]);
    expect(selectDueAutomations(list, NOW).map((d) => [d.automation.name, d.groupIndex])).toEqual([
      ["Dia", 1],
      ["Tarde", 4],
    ]);
  });
});

describe("runAutomations", () => {
  it("roda o gerador só para as automações vencidas (e2e Shopee simulada)", async () => {
    const server = await startOffersServer({ nodes: [offerNode(11)] });
    try {
      const client = new ShopeeClient({ appId: "test-app-id", secret: "test-secret" }, { endpoint: server.url });
      const outbox = await tmpRoot();
      const { logger } = collectLogger();
      const list = parse([
        automation({ name: "A", days: [5], windowStart: "08:00", windowEnd: "22:00" }),
        automation({ name: "B", days: [1], windowStart: "08:00", windowEnd: "22:00" }),
        automation({ name: "C", days: [5], windowStart: "14:00", windowEnd: "15:00" }),
      ]);
      const summary = await runAutomations(
        list,
        { runStartedAt: NOW, affiliateHandle: "@x", imageHosts: ["img.test"] },
        {
          source: client,
          shortLinker: client,
          fetchImage: fakeImageFetcher(),
          renderCreative: fakeRenderCreative(),
          channel: createFileOutbox({ dir: outbox }),
          logger,
        },
      );

      expect(summary.results.map((r) => [r.name, r.groupIndex])).toEqual([
        ["A", 1],
        ["C", 3],
      ]);
      expect(summary.delivered).toBe(2);
      expect(summary.failed).toBe(0);
      const files = await readdir(join(outbox, "20261016"));
      expect(files).toContain("1432-11-g1.md");
      expect(files).toContain("1432-11-g3.md");
      expect(files).not.toContain("1432-11-g2.md"); // B não estava vencida
    } finally {
      await server.close();
    }
  });

  it("sem automação no horário não chama a Shopee", async () => {
    const outbox = await tmpRoot();
    const { logger } = collectLogger();
    let called = 0;
    const summary = await runAutomations(
      parse([automation({ days: [1] })]),
      { runStartedAt: NOW, affiliateHandle: "@x", imageHosts: ["img.test"] },
      {
        source: {
          productOfferV2: async () => {
            called += 1;
            return { nodes: [], pageInfo: { hasNextPage: false } };
          },
        },
        shortLinker: fakeShortLinker(),
        fetchImage: fakeImageFetcher(),
        renderCreative: fakeRenderCreative(),
        channel: createFileOutbox({ dir: outbox }),
        logger,
      },
    );
    expect(summary.results).toEqual([]);
    expect(summary.delivered).toBe(0);
    expect(called).toBe(0);
  });
});
