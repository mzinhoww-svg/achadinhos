import { afterAll, describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createFileOutbox } from "@achadinhos/channel";
import { ShopeeHttpError } from "@achadinhos/shopee";

import { resolveConfig, runOutboxCli, type CliWiring } from "../../src/gerar/cli.js";
import {
  cleanupRoots,
  fakeImageFetcher,
  fakeRenderCreative,
  fakeShortLinker,
  offerNode,
  tmpRoot,
} from "./helpers.js";

afterAll(cleanupRoots);

const RUN = new Date("2026-10-16T18:32:00.000Z");
const ENV = {
  SHOPEE_APP_ID: "app",
  SHOPEE_SECRET: "s3cr3t-value",
  SHOPEE_ENDPOINT: "http://127.0.0.1:1/graphql",
  AFFILIATE_HANDLE: "@afiliado",
  IMAGE_ALLOWED_HOSTS: "img.test",
};

describe("runOutboxCli", () => {
  it("config incompleta → exit 2 e nenhuma linha com o Secret", async () => {
    const lines: string[] = [];
    const result = await runOutboxCli({
      argv: [],
      env: { SHOPEE_APP_ID: "app", SHOPEE_SECRET: "s3cr3t-value" },
      write: (line) => lines.push(line),
    });
    expect(result.exitCode).toBe(2);
    expect(lines.join("\n")).not.toContain("s3cr3t-value");
    expect(lines.join("\n")).toContain("SHOPEE_ENDPOINT");
  });

  it("entrega pelo wiring injetado e sai 0", async () => {
    const outbox = await tmpRoot();
    const makeWiring = (): CliWiring => ({
      source: { productOfferV2: async () => ({ nodes: [offerNode(77)], pageInfo: { hasNextPage: false } }) },
      shortLinker: fakeShortLinker(),
      fetchImage: fakeImageFetcher(),
      renderCreative: fakeRenderCreative(),
      channel: createFileOutbox({ dir: outbox }),
    });
    const lines: string[] = [];
    const result = await runOutboxCli({
      argv: ["--outbox", outbox, "--limite", "1"],
      env: ENV,
      makeWiring,
      now: () => RUN,
      write: (line) => lines.push(line),
    });
    expect(result.exitCode).toBe(0);
    expect(result.summary?.delivered).toBe(1);
    expect(lines.join("\n")).toContain("resumo: 1 delivered");
  });

  it("--help não exige configuração", async () => {
    const lines: string[] = [];
    const result = await runOutboxCli({ argv: ["--help"], env: {}, write: (line) => lines.push(line) });
    expect(result.exitCode).toBe(0);
    expect(lines.join("\n")).toContain("outbox:gerar");
  });

  it("endpoint fora de loopback sem --permitir-real → exit 2 e zero chamadas ao wiring (R1)", async () => {
    let wired = 0;
    const makeWiring = (): CliWiring => {
      wired += 1;
      throw new Error("wiring não deveria ser montado");
    };
    const lines: string[] = [];
    const result = await runOutboxCli({
      argv: ["--endpoint", "https://open-api.affiliate.shopee.com.br/graphql"],
      env: ENV,
      makeWiring,
      write: (line) => lines.push(line),
    });
    expect(result.exitCode).toBe(2);
    expect(result.summary).toBeUndefined();
    expect(wired).toBe(0);
    expect(lines.join("\n")).toMatch(/loopback/);
  });

  it("endpoint real com --permitir-real sem --limite → exit 2, sem wiring", async () => {
    let wired = 0;
    const makeWiring = (): CliWiring => {
      wired += 1;
      throw new Error("wiring não deveria ser montado");
    };
    const lines: string[] = [];
    const result = await runOutboxCli({
      argv: ["--endpoint", "https://open-api.affiliate.shopee.com.br/graphql", "--permitir-real"],
      env: ENV,
      makeWiring,
      write: (line) => lines.push(line),
    });
    expect(result.exitCode).toBe(2);
    expect(wired).toBe(0);
    expect(lines.join("\n")).toMatch(/--limite/);
  });

  it("endpoint real com --permitir-real e --limite imprime chamadas_max e segue", async () => {
    const outbox = await tmpRoot();
    const makeWiring = (): CliWiring => ({
      source: { productOfferV2: async () => ({ nodes: [], pageInfo: { hasNextPage: false } }) },
      shortLinker: fakeShortLinker(),
      fetchImage: fakeImageFetcher(),
      renderCreative: fakeRenderCreative(),
      channel: createFileOutbox({ dir: outbox }),
    });
    const lines: string[] = [];
    const result = await runOutboxCli({
      argv: ["--endpoint", "https://open-api.affiliate.shopee.com.br/graphql", "--permitir-real", "--limite", "3"],
      env: ENV,
      makeWiring,
      now: () => RUN,
      write: (line) => lines.push(line),
    });
    expect(result.exitCode).toBe(0);
    expect(lines.join("\n")).toContain("chamadas_max=4"); // REAL_PAGES_MAX(1) + limite(3)
  });

  it("recusa --limite < 1", () => {
    expect(resolveConfig({ limit: 0 }, ENV)).toMatch(/--limite/);
  });

  it("--automacoes com arquivo ausente → exit 2, código fixo, sem wiring", async () => {
    let wired = 0;
    const makeWiring = (): CliWiring => {
      wired += 1;
      throw new Error("wiring não deveria ser montado");
    };
    const lines: string[] = [];
    const result = await runOutboxCli({
      argv: ["--automacoes", "/caminho/que/nao/existe.json"],
      env: ENV,
      makeWiring,
      write: (line) => lines.push(line),
    });
    expect(result.exitCode).toBe(2);
    expect(wired).toBe(0);
    expect(lines.join("\n")).toContain("automacoes_ausentes");
  });

  it("--permitir-real com automações: chamadas_max = vencidas × (páginas + limite) (R1/B2)", async () => {
    const outbox = await tmpRoot();
    const dir = await tmpRoot();
    const file = join(dir, "automacoes.json");
    const auto = (name: string): Record<string, unknown> => ({
      name,
      filters: {},
      days: [0, 1, 2, 3, 4, 5, 6],
      windowStart: "00:00",
      windowEnd: "23:59",
      frequencyMin: 30,
      timeZone: "America/Cuiaba",
    });
    await writeFile(file, JSON.stringify({ automacoes: [auto("A"), auto("B"), auto("C")] }));

    let offersCalls = 0;
    let linkCalls = 0;
    const makeWiring = (): CliWiring => ({
      source: {
        productOfferV2: async () => {
          offersCalls += 1;
          return { nodes: [offerNode(11), offerNode(22)], pageInfo: { hasNextPage: false } };
        },
      },
      shortLinker: {
        generateShortLink: async () => {
          linkCalls += 1;
          return { shortLink: "https://shope.ee/sim" };
        },
      },
      fetchImage: fakeImageFetcher(),
      renderCreative: fakeRenderCreative(),
      channel: createFileOutbox({ dir: outbox }),
    });
    const lines: string[] = [];
    const result = await runOutboxCli({
      argv: [
        "--endpoint",
        "https://open-api.affiliate.shopee.com.br/graphql",
        "--permitir-real",
        "--limite",
        "2",
        "--automacoes",
        file,
        "--agora",
        "2026-10-16T18:32:00Z",
      ],
      env: ENV,
      makeWiring,
      write: (line) => lines.push(line),
    });
    expect(result.exitCode).toBe(0);
    // 3 vencidas × (1 página + limite 2) = 9
    expect(lines.join("\n")).toContain("chamadas_max=9");
    expect(offersCalls + linkCalls).toBeLessThanOrEqual(9);
  });

  it("--automacoes: busca caída em uma automação → exit 1 e a outra segue (B1)", async () => {
    const outbox = await tmpRoot();
    const dir = await tmpRoot();
    const file = join(dir, "automacoes.json");
    const auto = (name: string, keyword: string): Record<string, unknown> => ({
      name,
      filters: { keywords: [keyword] },
      days: [0, 1, 2, 3, 4, 5, 6],
      windowStart: "00:00",
      windowEnd: "23:59",
      frequencyMin: 30,
      timeZone: "America/Cuiaba",
    });
    await writeFile(file, JSON.stringify({ automacoes: [auto("Boom", "boom"), auto("Ok", "produto")] }));

    const makeWiring = (): CliWiring => ({
      source: {
        productOfferV2: async (params) => {
          if (params.keyword === "boom") throw new ShopeeHttpError(500);
          return { nodes: [offerNode(11)], pageInfo: { hasNextPage: false } };
        },
      },
      shortLinker: fakeShortLinker(),
      fetchImage: fakeImageFetcher(),
      renderCreative: fakeRenderCreative(),
      channel: createFileOutbox({ dir: outbox }),
    });
    const lines: string[] = [];
    const result = await runOutboxCli({
      argv: ["--automacoes", file, "--agora", "2026-10-16T18:32:00Z"],
      env: ENV,
      makeWiring,
      write: (line) => lines.push(line),
    });
    expect(result.exitCode).toBe(1);
    expect(result.automations?.fetchErrors).toBe(1);
    expect(result.automations?.delivered).toBe(1);
    expect(lines.join("\n")).toContain("shopee_http");
  });

  it("--automacoes sem vencida imprime linha clara e sai 0", async () => {
    const dir = await tmpRoot();
    const file = join(dir, "automacoes.json");
    await writeFile(
      file,
      JSON.stringify({
        automacoes: [
          {
            name: "Segunda",
            filters: {},
            days: [1],
            windowStart: "08:00",
            windowEnd: "22:00",
            frequencyMin: 30,
            timeZone: "America/Cuiaba",
          },
        ],
      }),
    );
    const lines: string[] = [];
    const result = await runOutboxCli({
      argv: ["--automacoes", file, "--agora", "2026-10-16T18:32:00Z"],
      env: ENV,
      makeWiring: () => {
        throw new Error("não deveria montar wiring sem automação vencida");
      },
      write: (line) => lines.push(line),
    });
    expect(result.exitCode).toBe(0);
    expect(lines.join("\n")).toContain("nenhuma_automacao_vencida");
  });

  it("--automacoes válido roda o gerador por automação e sai 0", async () => {
    const outbox = await tmpRoot();
    const dir = await tmpRoot();
    const file = join(dir, "automacoes.json");
    await writeFile(
      file,
      JSON.stringify({
        automacoes: [
          {
            name: "A",
            filters: {},
            days: [0, 1, 2, 3, 4, 5, 6],
            windowStart: "00:00",
            windowEnd: "23:59",
            frequencyMin: 30,
            timeZone: "America/Cuiaba",
          },
        ],
      }),
    );
    const makeWiring = (): CliWiring => ({
      source: { productOfferV2: async () => ({ nodes: [offerNode(55)], pageInfo: { hasNextPage: false } }) },
      shortLinker: fakeShortLinker(),
      fetchImage: fakeImageFetcher(),
      renderCreative: fakeRenderCreative(),
      channel: createFileOutbox({ dir: outbox }),
    });
    const lines: string[] = [];
    const result = await runOutboxCli({
      argv: ["--automacoes", file, "--agora", "2026-10-16T18:32:00Z"],
      env: ENV,
      makeWiring,
      write: (line) => lines.push(line),
    });
    expect(result.exitCode).toBe(0);
    expect(result.automations?.delivered).toBe(1);
    expect(lines.join("\n")).toContain("automacao 1 A");
  });
});
