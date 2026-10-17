import { pathToFileURL } from "node:url";

import { MAX_CREATIVE_PNG_BYTES, createFileOutbox } from "@achadinhos/channel";
import { renderOfferCreative } from "@achadinhos/creative/render";
import type { ImageMime } from "@achadinhos/creative/image";
import { ShopeeClient } from "@achadinhos/shopee";

import { downloadProductImage } from "../image.js";
import { createLogger, type Level, type Logger } from "../logger.js";
import { ArgvError, HELP, parseArgs, type CliArgs } from "./argv.js";
import {
  clampLimit,
  exitCodeFor,
  generateOutbox,
  type GenerateSummary,
  type GenerateTracking,
} from "./generate.js";
import type { Channel, ImageFetcher, OfferSource, RenderCreative, ShortLinker } from "./ports.js";

/** Mesma allowlist do worker de produção (`sql/build-deps.ts`). */
export const DEFAULT_IMAGE_HOSTS = ["shopee.com.br", "susercontent.com", "shopeemobile.com"];
const DOWNLOAD_TIMEOUT_MS = 15_000;
const DEFAULT_GROUP_INDEX = 1;

export interface CliConfig {
  endpoint: string;
  outboxDir: string;
  limit: number;
  group: { index: number; label: string };
  keyword?: string;
  affiliateHandle: string;
  imageHosts: string[];
  tracking: GenerateTracking;
}

export interface CliWiring {
  source: OfferSource;
  shortLinker: ShortLinker;
  fetchImage: ImageFetcher;
  renderCreative: RenderCreative;
  channel: Channel;
}

export interface RunCliOptions {
  argv: string[];
  env: Record<string, string | undefined>;
  now?: () => Date;
  write?: (line: string) => void;
  /** Injeção (testes): substitui os adaptadores reais; os segredos nunca passam por aqui. */
  makeWiring?: (config: CliConfig, env: Record<string, string | undefined>) => CliWiring;
}

export interface RunCliResult {
  exitCode: number;
  summary?: GenerateSummary;
}

function imageHostsFrom(env: Record<string, string | undefined>): string[] {
  const raw = env["IMAGE_ALLOWED_HOSTS"];
  if (!raw) return [...DEFAULT_IMAGE_HOSTS];
  const hosts = raw.split(",").map((h) => h.trim()).filter(Boolean);
  return hosts.length ? hosts : [...DEFAULT_IMAGE_HOSTS];
}

function limitFrom(args: CliArgs, env: Record<string, string | undefined>): number {
  if (args.limit !== undefined) return clampLimit(args.limit);
  const raw = env["OUTBOX_LIMIT"];
  return clampLimit(raw === undefined ? undefined : Number(raw));
}

/** Resolve a configuração; devolve uma mensagem fixa (sem segredo) quando falta algo. */
export function resolveConfig(args: CliArgs, env: Record<string, string | undefined>): CliConfig | string {
  const endpoint = args.endpoint ?? env["SHOPEE_ENDPOINT"];
  if (!endpoint) return "defina SHOPEE_ENDPOINT (aponte ao servidor simulado); nenhuma chamada real é feita sem isso";
  if (!env["SHOPEE_APP_ID"] || !env["SHOPEE_SECRET"]) return "defina SHOPEE_APP_ID e SHOPEE_SECRET";

  const affiliateHandle = args.handle ?? env["AFFILIATE_HANDLE"];
  if (!affiliateHandle) return "defina AFFILIATE_HANDLE ou --handle";

  const groupIndex = args.groupIndex ?? DEFAULT_GROUP_INDEX;
  if (!Number.isInteger(groupIndex) || groupIndex < 1 || groupIndex > 99) return "--grupo-indice fora de 1..99";
  const groupLabel = args.groupLabel ?? `Grupo ${groupIndex}`;

  const tracking: GenerateTracking = {};
  if (env["OUTBOX_ACCOUNT"]) tracking.account = env["OUTBOX_ACCOUNT"];
  if (env["OUTBOX_AUTOMATION"]) tracking.automation = env["OUTBOX_AUTOMATION"];
  if (env["OUTBOX_GROUP_SUBID"]) tracking.group = env["OUTBOX_GROUP_SUBID"];

  return {
    endpoint,
    outboxDir: args.outbox ?? env["OUTBOX_DIR"] ?? "outbox",
    limit: limitFrom(args, env),
    group: { index: groupIndex, label: groupLabel },
    ...(args.keyword ? { keyword: args.keyword } : {}),
    affiliateHandle,
    imageHosts: imageHostsFrom(env),
    tracking,
  };
}

/** Adaptadores reais: ShopeeClient (credenciais por env), downloader seguro, criativo e FileOutbox. */
function makeRealWiring(config: CliConfig, env: Record<string, string | undefined>): CliWiring {
  const client = new ShopeeClient(
    { appId: env["SHOPEE_APP_ID"] ?? "", secret: env["SHOPEE_SECRET"] ?? "" },
    { endpoint: config.endpoint },
  );
  const fetchImage: ImageFetcher = (imageUrl) =>
    downloadProductImage(imageUrl, {
      allowedHosts: config.imageHosts,
      maxBytes: MAX_CREATIVE_PNG_BYTES,
      timeoutMs: DOWNLOAD_TIMEOUT_MS,
    });
  const renderCreative: RenderCreative = (input) =>
    renderOfferCreative(
      {
        title: input.title,
        // já baixada: o `fetchImage` injetado devolve os bytes e o URL não é usado
        imageUrl: "https://local/ja-baixada",
        priceCurrent: input.priceCurrent,
        priceOld: input.priceOld,
        affiliateHandle: input.affiliateHandle,
      },
      {
        fetchImage: async () => ({
          bytes: input.image.bytes,
          mime: input.image.mime as ImageMime,
          width: 0,
          height: 0,
        }),
      },
    );
  return {
    source: client,
    shortLinker: client,
    fetchImage,
    renderCreative,
    channel: createFileOutbox({ dir: config.outboxDir }),
  };
}

/** Executa a CLI com dependências injetáveis (testes) ou os adaptadores reais. */
export async function runOutboxCli(options: RunCliOptions): Promise<RunCliResult> {
  const write = options.write ?? ((line: string) => console.log(line));
  const env = options.env;
  const args = parseArgs(options.argv);
  if (args.help) {
    write(HELP);
    return { exitCode: 0 };
  }

  const config = resolveConfig(args, env);
  if (typeof config === "string") {
    write(JSON.stringify({ level: "error", msg: "config_invalida", code: "config" }));
    write(config);
    return { exitCode: 2 };
  }

  const secret = env["SHOPEE_SECRET"];
  const logger: Logger = createLogger({
    sink: write,
    level: (env["LOG_LEVEL"] as Level | undefined) ?? "info",
    ...(secret ? { secrets: [secret] } : {}),
  });

  const wiring = (options.makeWiring ?? makeRealWiring)(config, env);
  const runStartedAt = (options.now ?? (() => new Date()))();

  const summary = await generateOutbox(
    {
      runStartedAt,
      group: config.group,
      affiliateHandle: config.affiliateHandle,
      imageHosts: config.imageHosts,
      limit: config.limit,
      ...(config.keyword ? { keyword: config.keyword } : {}),
      tracking: config.tracking,
    },
    {
      source: wiring.source,
      shortLinker: wiring.shortLinker,
      fetchImage: wiring.fetchImage,
      renderCreative: wiring.renderCreative,
      channel: wiring.channel,
      logger,
    },
  );

  write(
    `resumo: ${summary.delivered} delivered, ${summary.failed} failed, ${summary.unknown} unknown` +
      (summary.fetchError ? ` (${summary.fetchError})` : ""),
  );
  return { exitCode: exitCodeFor(summary), summary };
}

async function main(): Promise<void> {
  const result = await runOutboxCli({ argv: process.argv.slice(2), env: process.env });
  process.exitCode = result.exitCode;
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (entry !== "" && import.meta.url === entry) {
  main().catch((error: unknown) => {
    const code = error instanceof ArgvError ? "argumento_invalido" : "erro_interno";
    console.error(JSON.stringify({ level: "error", msg: "falha_inesperada", code }));
    process.exitCode = 2;
  });
}
