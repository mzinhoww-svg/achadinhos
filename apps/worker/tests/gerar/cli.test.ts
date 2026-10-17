import { afterAll, describe, expect, it } from "vitest";

import { createFileOutbox } from "@achadinhos/channel";

import { runOutboxCli, type CliWiring } from "../../src/gerar/cli.js";
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
});
