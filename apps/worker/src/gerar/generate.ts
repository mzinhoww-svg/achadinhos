import {
  AFFILIATE_LINK_HOSTS,
  MAX_CREATIVE_PNG_BYTES,
  isAllowedLink,
  type OutboundOffer,
  type Slot,
} from "@achadinhos/channel";
import {
  ShopeeConfigError,
  ShopeeError,
  ShopeeGraphQLError,
  ShopeeHttpError,
  ShopeeNetworkError,
  ShopeeSchemaError,
  ShopeeSignatureError,
  ShopeeTimeoutError,
} from "@achadinhos/shopee";
import { filterOffers, type OfferFilters, type OfferLike } from "@achadinhos/domain";
import { ImageRejectedError } from "../image.js";
import { invalidNodeReason, type OfferSource } from "../offer-selection.js";
import type { ProductOfferNode } from "../scheduler-ports.js";
import type { Logger } from "../logger.js";
import { discountOf, messageText } from "./message.js";
import { slotForRun } from "./slot.js";
import type { Channel, ImageFetcher, RenderCreative, ShortLinker } from "./ports.js";

export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 50;
/** Tamanho de página pedido à Shopee (mesmo valor de `offer-selection`). */
export const PAGE_LIMIT = 50;
const MAX_PAGES = 10;

export interface GenerateGroup {
  index: number;
  label: string;
}

/** Rótulos internos (sem dado pessoal) usados nos subIds de rastreio. */
export interface GenerateTracking {
  account?: string;
  automation?: string;
  group?: string;
}

export interface GenerateInput {
  /** Início da execução; fonte única do `Slot` e do `generatedAtUtc` (§1 B1). */
  runStartedAt: Date;
  group: GenerateGroup;
  affiliateHandle: string;
  /** Allowlist do download da imagem (mesma decisão 002 C1 do worker). */
  imageHosts: readonly string[];
  limit?: number;
  filters?: OfferFilters;
  keyword?: string;
  tracking?: GenerateTracking;
  signal?: AbortSignal;
}

export interface GenerateDeps {
  source: OfferSource;
  shortLinker: ShortLinker;
  fetchImage: ImageFetcher;
  renderCreative: RenderCreative;
  channel: Channel;
  logger: Logger;
}

export type OfferStatus = "delivered" | "failed" | "unknown";

export interface OfferOutcome {
  slotKey: string;
  status: OfferStatus;
  /** Código fixo (nunca mensagem de erro) quando não entregue. */
  code?: string;
}

export interface GenerateSummary {
  slot: Slot;
  /** Teto pedido (após clamp em 1..50). */
  limit: number;
  results: OfferOutcome[];
  delivered: number;
  failed: number;
  unknown: number;
  /** Código fixo quando a busca de ofertas falhou inteira (nada foi tentado). */
  fetchError?: string;
}

export function clampLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(value)));
}

/** subIds internos (<= 5), posições [conta, automação, grupo, canal, envio]; o "envio" aqui é o itemId. */
export function subIdsFor(tracking: GenerateTracking | undefined, group: GenerateGroup, itemId: string): string[] {
  return [
    tracking?.account ?? "local",
    tracking?.automation ?? "gerar",
    tracking?.group ?? String(group.index),
    "file-outbox",
    itemId,
  ].map((part) => part.trim().slice(0, 64));
}

/** `0` só quando nada falhou e a busca deu certo; qualquer `failed`/`unknown`/erro de busca sai `1`. */
export function exitCodeFor(summary: GenerateSummary): 0 | 1 {
  return summary.fetchError === undefined && summary.failed === 0 && summary.unknown === 0 ? 0 : 1;
}

/** Erro da Shopee → código fixo. A mensagem original nunca chega ao log nem ao resumo. */
function shopeeCode(error: unknown, fallback: string): string {
  if (error instanceof ShopeeTimeoutError) return "timeout_shopee";
  if (error instanceof ShopeeSignatureError) return "shopee_assinatura_invalida";
  if (error instanceof ShopeeGraphQLError) return "shopee_graphql";
  if (error instanceof ShopeeSchemaError) return "shopee_schema";
  if (error instanceof ShopeeHttpError) return "shopee_http";
  if (error instanceof ShopeeNetworkError) return "shopee_rede";
  if (error instanceof ShopeeConfigError) return "shopee_config";
  if (error instanceof ShopeeError) return "shopee_erro";
  return fallback;
}

/** Busca páginas de ofertas até juntar `limit` ofertas válidas, filtrando e deduplicando só dentro do lote. */
async function collectOffers(input: GenerateInput, deps: GenerateDeps, limit: number): Promise<ProductOfferNode[]> {
  const chosen: ProductOfferNode[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= MAX_PAGES && chosen.length < limit; page += 1) {
    const params: { page: number; limit: number; keyword?: string } = { page, limit: PAGE_LIMIT };
    if (input.keyword) params.keyword = input.keyword;
    const page0 = await deps.source.productOfferV2(params);
    if (!page0 || !Array.isArray(page0.nodes) || !page0.pageInfo) {
      throw new ShopeeSchemaError("resposta fora do formato (nodes/pageInfo)", "SCHEMA");
    }
    const usable: ProductOfferNode[] = [];
    for (const node of page0.nodes) {
      if (!node || typeof node !== "object") continue;
      if (invalidNodeReason(node, { imageHosts: input.imageHosts })) continue;
      const id = String(node.itemId);
      if (seen.has(id)) continue;
      seen.add(id);
      usable.push(node);
    }
    const passing = filterOffers(usable as unknown as OfferLike[], input.filters ?? {}) as unknown as ProductOfferNode[];
    for (const node of passing) {
      if (chosen.length >= limit) break;
      chosen.push(node);
    }
    if (!page0.pageInfo.hasNextPage) break;
  }
  return chosen;
}

interface DeliverContext {
  slot: Slot;
  generatedAtUtc: string;
  input: GenerateInput;
  deps: GenerateDeps;
}

async function deliverOffer(offer: ProductOfferNode, ctx: DeliverContext): Promise<OfferOutcome> {
  const { slot, input, deps } = ctx;
  const itemId = String(offer.itemId);
  const slotKey = `${slot.day}/${slot.hhmm}-${itemId}-g${slot.groupIndex}`;
  const fail = (code: string): OfferOutcome => ({ slotKey, status: "failed", code });

  if (!isAllowedLink(offer.productLink, [...AFFILIATE_LINK_HOSTS])) return fail("link_invalido");

  let shortLink: string;
  try {
    const result = await deps.shortLinker.generateShortLink({
      originUrl: offer.productLink,
      subIds: subIdsFor(input.tracking, input.group, itemId),
    });
    shortLink = result?.shortLink;
  } catch (error) {
    return fail(shopeeCode(error, "link_falhou"));
  }
  if (!isAllowedLink(shortLink, [...AFFILIATE_LINK_HOSTS])) return fail("link_invalido");

  let image;
  try {
    image = await deps.fetchImage(offer.imageUrl);
  } catch (error) {
    return fail(error instanceof ImageRejectedError ? `imagem_${error.code}` : "imagem");
  }

  const priceCurrent = offer.priceMin;
  const priceOld = offer.priceMax;
  const discountPct = discountOf(offer);

  let creativePng: Uint8Array;
  try {
    creativePng = await deps.renderCreative({
      title: offer.productName,
      image,
      priceCurrent,
      priceOld,
      discountPct,
      affiliateHandle: input.affiliateHandle,
    });
  } catch {
    return fail("criativo_falhou");
  }
  if (!(creativePng instanceof Uint8Array) || creativePng.length > MAX_CREATIVE_PNG_BYTES) {
    return fail("png_invalido");
  }

  const outbound: OutboundOffer = {
    slot,
    itemId,
    title: offer.productName,
    text: messageText(offer.productName, priceCurrent, priceOld, discountPct, shortLink),
    affiliateLink: shortLink,
    priceCurrent,
    priceOld,
    discountPct,
    creativePng,
    generatedAtUtc: ctx.generatedAtUtc,
    groupLabel: input.group.label,
  };

  const signal = input.signal ?? new AbortController().signal;
  const result = await deps.channel.deliver(outbound, { signal });
  if (result.status === "delivered") return { slotKey, status: "delivered" };
  return { slotKey, status: result.status, code: result.code };
}

/**
 * Gera a outbox de uma execução: busca, filtra, deduplica o lote, gera link curto, baixa a imagem,
 * renderiza o criativo e entrega pelo `Channel`. Sem laço de retry: a falha de uma oferta vira código
 * fixo e a execução segue para a próxima.
 */
export async function generateOutbox(input: GenerateInput, deps: GenerateDeps): Promise<GenerateSummary> {
  const slot = slotForRun(input.runStartedAt, input.group.index);
  const limit = clampLimit(input.limit);
  const generatedAtUtc = input.runStartedAt.toISOString();
  const results: OfferOutcome[] = [];

  let offers: ProductOfferNode[] = [];
  let fetchError: string | undefined;
  try {
    offers = await collectOffers(input, deps, limit);
  } catch (error) {
    fetchError = shopeeCode(error, "busca_falhou");
    deps.logger.error("busca_falhou", { code: fetchError });
  }

  const context: DeliverContext = { slot, generatedAtUtc, input, deps };
  for (const offer of offers) {
    if (input.signal?.aborted) break;
    const outcome = await deliverOffer(offer, context);
    results.push(outcome);
    deps.logger.info("oferta", {
      slotKey: outcome.slotKey,
      status: outcome.status,
      ...(outcome.code ? { code: outcome.code } : {}),
    });
  }

  const delivered = results.filter((r) => r.status === "delivered").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const unknown = results.filter((r) => r.status === "unknown").length;
  return {
    slot,
    limit,
    results,
    delivered,
    failed,
    unknown,
    ...(fetchError ? { fetchError } : {}),
  };
}
