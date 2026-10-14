import { filterOffers, filterNotRepeated, type OfferFilters, type OfferLike } from "@achadinhos/domain";
import type { ProductOfferV2Params } from "@achadinhos/shopee";
import { withDeadline } from "./deadline.js";
import type { OfferSelector, ProductOfferNode, SelectionInput, SelectionResult, SendHistoryRow } from "./ports.js";

/** Motivo gravado pelo reaper quando o resultado do envio é desconhecido (decisão 001 A4/A5). */
export const UNKNOWN_RESULT_REASON = "lease_expirado_resultado_desconhecido";

export const DEFAULT_SELECTION_TIMEOUT_MS = 15_000;
const DEFAULT_PAGES = 3;
const PAGE_LIMIT = 50;

export class OfferSourceError extends Error {
  override readonly name = "OfferSourceError";
}

export type DiscardedNode = { itemId: string | null; reason: string };

function httpsUrl(v: unknown): boolean {
  if (typeof v !== "string" || v.trim() === "") return false;
  try {
    return new URL(v).protocol === "https:";
  } catch {
    return false;
  }
}

/** Motivo de descarte, ou null se o nó é utilizável pelo executor (QA #14: nó inválido envenenava o grupo). */
export function invalidNodeReason(n: ProductOfferNode): string | null {
  const id = (n as { itemId?: unknown }).itemId;
  if (id === undefined || id === null || String(id).trim() === "") return "item_id_ausente";
  if (typeof n.productName !== "string" || n.productName.trim() === "") return "titulo_vazio";
  if (!httpsUrl(n.offerLink)) return "offerLink_invalido";
  if (!httpsUrl(n.imageUrl)) return "imageUrl_invalida";
  if (typeof n.priceMin !== "number" || !Number.isFinite(n.priceMin) || n.priceMin <= 0) return "preco_invalido";
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
          (r.status === "failed" && r.reason === UNKNOWN_RESULT_REASON)),
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
      const why = n && typeof n === "object" ? invalidNodeReason(n) : "no_invalido";
      if (why) {
        const id = (n as { itemId?: unknown } | null)?.itemId;
        input.onDiscard?.({ itemId: id == null ? null : String(id), reason: why });
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
  options: { timeoutMs?: number; maxPages?: number; onDiscard?: (n: DiscardedNode) => void } = {},
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
      ...(options.onDiscard ? { onDiscard: options.onDiscard } : {}),
    });
}
