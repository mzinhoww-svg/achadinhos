import { filterOffers, filterNotRepeated, type OfferFilters, type OfferLike } from "@achadinhos/domain";
import type { ProductOfferV2Params } from "@achadinhos/shopee";
import { withDeadline } from "./deadline.js";
import type { OfferSelector, ProductOfferNode, SelectionInput, SelectionResult, SendHistoryRow } from "./ports.js";

/** Motivo gravado pelo reaper quando o resultado do envio é desconhecido (decisão 001 A4/A5). */
export const UNKNOWN_RESULT_REASON = "lease_expirado_resultado_desconhecido";

export const DEFAULT_SELECTION_TIMEOUT_MS = 15_000;
const DEFAULT_PAGES = 3;
const PAGE_LIMIT = 50;

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
};

/** Histórico que bloqueia repetição: enviados, em andamento e resultado desconhecido (A5). Falha limpa e skipped não bloqueiam. */
function blockingHistory(history: SendHistoryRow[], groupId: string) {
  return history
    .filter(
      (r) =>
        r.itemId != null &&
        (r.status === "sent" ||
          r.status === "queued" ||
          r.status === "sending" ||
          (r.status === "failed" && r.reason === UNKNOWN_RESULT_REASON)),
    )
    .map((r) => ({
      group_id: groupId,
      item_id: r.itemId as string,
      status: "sent",
      sent_at: r.sentAt ?? r.attemptedAt ?? r.createdAt,
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
  const history = blockingHistory(input.history, groupId);
  const keyword = keywordOf(filters);

  let sawEligibleButRepeated = false;
  for (let page = 1; page <= maxPages; page++) {
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) throw new Error(`timeout após ${total}ms: busca de ofertas`);
    const params: ProductOfferV2Params = { page, limit: PAGE_LIMIT };
    if (keyword !== undefined) params.keyword = keyword;
    const result = await withDeadline(source.productOfferV2(params), remaining, "productOfferV2");

    const passing = filterOffers(result.nodes as unknown as OfferLike[], filters) as unknown as ProductOfferNode[];
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
  options: { timeoutMs?: number; maxPages?: number } = {},
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
    });
}
