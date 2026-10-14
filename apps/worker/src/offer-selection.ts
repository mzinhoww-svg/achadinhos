import {
  DEFAULT_SHOPEE_LINK_HOSTS,
  filterNotRepeated,
  filterOffers,
  isAllowedLink,
  isUnknownResultReason,
  sendableOfferField,
  type OfferFilters,
  type OfferLike,
} from "@achadinhos/domain";
import type { ProductOfferV2Params } from "@achadinhos/shopee";
import { withDeadline } from "./deadline.js";
import type { OfferSelector, ProductOfferNode, SelectionInput, SelectionResult, SendHistoryRow } from "./ports.js";

/** Motivo do reaper (decisão 001 A4/A5); o critério de bloqueio é o sufixo `_resultado_desconhecido`. */
export const UNKNOWN_RESULT_REASON = "lease_expirado_resultado_desconhecido";
const REJECTION_BLOCK_MS = 24 * 3_600_000;

/** Recusa do executor por oferta/link/imagem: não pode voltar no slot seguinte. */
function isOfferRejection(r: SendHistoryRow): boolean {
  const reason = r.reason ?? "";
  return (
    (r.status === "failed" && (reason === "link_invalido" || reason.startsWith("imagem_"))) ||
    (r.status === "skipped" && reason.startsWith("oferta_invalida_"))
  );
}

export const DEFAULT_SELECTION_TIMEOUT_MS = 15_000;
const DEFAULT_PAGES = 3;
const PAGE_LIMIT = 50;

export class OfferSourceError extends Error {
  override readonly name = "OfferSourceError";
}

export type DiscardedNode = { itemId: string | null; reason: string };

/** Motivo de descarte, ou null se o nó passa no MESMO critério do executor (domain/sendable). */
export function invalidNodeReason(
  n: ProductOfferNode,
  hosts: { linkHosts?: readonly string[]; imageHosts: readonly string[] },
): string | null {
  const id = (n as { itemId?: unknown }).itemId;
  if (id === undefined || id === null || String(id).trim() === "") return "oferta_invalida_itemId";
  const field = sendableOfferField(
    {
      title: n.productName,
      priceCurrent: n.priceMin,
      priceOld: n.priceMax,
      discountPct: n.priceDiscountRate,
      productUrl: n.productLink,
      imageUrl: n.imageUrl,
    },
    hosts,
  );
  if (field) return `oferta_invalida_${field}`;
  // o executor gera o shortLink a partir do link de oferta: mesmo host permitido
  if (!isAllowedLink(n.offerLink, hosts.linkHosts ?? DEFAULT_SHOPEE_LINK_HOSTS)) return "oferta_invalida_offerLink";
  return null;
}

export interface OfferSource {
  productOfferV2(
    params: ProductOfferV2Params,
  ): Promise<{ nodes: ProductOfferNode[]; pageInfo: { hasNextPage: boolean } }>;
}

export type SelectOfferInput = Omit<SelectionInput, "accountId" | "automationId"> & {
  source: OfferSource;
  /** Prazo total (todas as páginas) da busca na Shopee. */
  timeoutMs?: number;
  maxPages?: number;
  /** Mesma allowlist que o executor usa para baixar a imagem (config); obrigatória de propósito. */
  imageHosts: readonly string[];
  linkHosts?: readonly string[];
  /** Chamado para cada nó descartado por formato inválido (motivo fixo, sem dado da Shopee). */
  onDiscard?: (node: DiscardedNode) => void;
};

/** Histórico que bloqueia repetição: enviados, em andamento e resultado desconhecido (A5). Falha limpa e skipped não bloqueiam. */
function blockingHistory(history: SendHistoryRow[], groupId: string, now: Date) {
  return history
    .filter(
      (r) =>
        r.itemId != null &&
        (r.status === "sent" ||
          r.status === "queued" ||
          r.status === "sending" ||
          (r.status === "failed" && isUnknownResultReason(r.reason))),
    )
    .map((r) => ({
      group_id: groupId,
      item_id: r.itemId as string,
      status: "sent",
      // sem data válida: fail-closed (conta como agora, bloqueia)
      sent_at: [r.sentAt, r.attemptedAt, r.createdAt].find((d) => d instanceof Date && !Number.isNaN(d.getTime())) ?? now,
    }));
}

function keywordOf(filters: OfferFilters): string | undefined {
  const raw = filters.keywords ?? filters.keyword ?? filters.search ?? filters.q;
  if (raw == null) return undefined;
  const text = Array.isArray(raw) ? raw.join(" ") : String(raw);
  const trimmed = text.trim().replace(/[\s,;]+/g, " ");
  return trimmed === "" ? undefined : trimmed;
}

export async function selectOffer(input: SelectOfferInput): Promise<SelectionResult> {
  const { source, filters, groupId, now, dedupeDays } = input;
  const total = input.timeoutMs ?? DEFAULT_SELECTION_TIMEOUT_MS;
  const maxPages = input.maxPages ?? DEFAULT_PAGES;
  const deadlineAt = Date.now() + total;
  const history = blockingHistory(input.history, groupId, now);
  const keyword = keywordOf(filters);
  const hosts = { imageHosts: input.imageHosts, ...(input.linkHosts ? { linkHosts: input.linkHosts } : {}) };
  const rejected = new Set(
    input.history
      .filter((r) => r.itemId != null && isOfferRejection(r))
      .filter((r) => {
        const at = r.attemptedAt ?? r.createdAt;
        return !(at instanceof Date) || Number.isNaN(at.getTime()) || now.getTime() - at.getTime() < REJECTION_BLOCK_MS;
      })
      .map((r) => String(r.itemId)),
  );

  let sawEligibleButRepeated = false;
  for (let page = 1; page <= maxPages; page++) {
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) throw new Error(`timeout após ${total}ms: busca de ofertas`);
    const params: ProductOfferV2Params = { page, limit: PAGE_LIMIT };
    if (keyword !== undefined) params.keyword = keyword;
    const result = await withDeadline(source.productOfferV2(params), remaining, "productOfferV2");

    if (!result || !Array.isArray((result as { nodes?: unknown }).nodes) || typeof (result as { pageInfo?: unknown }).pageInfo !== "object" || (result as { pageInfo?: unknown }).pageInfo === null) {
      throw new OfferSourceError("resposta da Shopee fora do formato esperado (nodes/pageInfo)");
    }
    const usable: ProductOfferNode[] = [];
    for (const n of result.nodes) {
      const why = n && typeof n === "object" ? invalidNodeReason(n, hosts) : "no_invalido";
      if (why) {
        const id = (n as { itemId?: unknown } | null)?.itemId;
        input.onDiscard?.({ itemId: id == null ? null : String(id), reason: why });
      } else if (rejected.has(String(n.itemId))) {
        input.onDiscard?.({ itemId: String(n.itemId), reason: "recusada_recentemente" });
      } else usable.push(n);
    }
    const passing = filterOffers(usable as unknown as OfferLike[], filters) as unknown as ProductOfferNode[];
    const fresh = filterNotRepeated(passing as unknown as { itemId?: unknown }[], history, {
      groupId,
      now,
      days: dedupeDays,
    }) as unknown as ProductOfferNode[];
    const first = fresh[0];
    if (first) return { kind: "offer", offer: first };
    if (passing.length > 0) sawEligibleButRepeated = true;
    if (!result.pageInfo.hasNextPage) break;
  }
  return { kind: "none", reason: sawEligibleButRepeated ? "repetida" : "sem_oferta" };
}

export function createOfferSelector(
  source: OfferSource,
  options: { imageHosts: readonly string[]; linkHosts?: readonly string[]; timeoutMs?: number; maxPages?: number; onDiscard?: (n: DiscardedNode) => void },
): OfferSelector {
  return (input) =>
    selectOffer({
      source,
      filters: input.filters,
      history: input.history,
      groupId: input.groupId,
      now: input.now,
      dedupeDays: input.dedupeDays,
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options.maxPages !== undefined ? { maxPages: options.maxPages } : {}),
      imageHosts: options.imageHosts,
      ...(options.linkHosts ? { linkHosts: options.linkHosts } : {}),
      ...(options.onDiscard ? { onDiscard: options.onDiscard } : {}),
    });
}
