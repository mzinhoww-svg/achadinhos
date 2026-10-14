/**
 * Portas do T8-06 ("Mandar agora"). A web nunca lê o Secret da Shopee (decisão 003 H1): quem consulta a Shopee
 * é o adaptador de `OfferFinder`/`ShortLinkGateway`, que roda onde a credencial vive (worker/endpoint interno).
 */

/** Oferta como a Shopee devolve. Os links de afiliado ficam no servidor: não saem para a UI. */
export interface OfferCandidate {
  itemId: string;
  title: string;
  imageUrl: string;
  productLink: string;
  offerLink: string;
  price: number;
  oldPrice: number;
  commissionRate: number;
  rating: number;
  sales: number;
  shopName: string;
  /** Só o modo demo: a prévia usa a foto fictícia em vez de baixar `imageUrl`. */
  placeholderHue?: number;
}

export interface OfferFinder {
  search(accountId: string, keyword: string): Promise<OfferCandidate[]>;
  byItemId(accountId: string, itemId: string): Promise<OfferCandidate | null>;
  /** Link curto/afiliado (`s.shopee.com.br/...`): só o adaptador sabe seguir. */
  resolveShortUrl(accountId: string, url: string): Promise<OfferCandidate | null>;
}

export interface ShortLinkGateway {
  /** `subIds` com no máximo 5 itens, só IDs internos (checklist E). */
  generate(accountId: string, originUrl: string, subIds: string[]): Promise<string>;
}

export type SendNowErrorCode = "forbidden" | "group_inactive";
export class SendNowError extends Error {
  constructor(readonly code: SendNowErrorCode) {
    super(code);
  }
}

export interface EnqueueResult {
  sendId: string;
  /** `true` quando o clique caiu em um envio já na fila (duplo clique). */
  duplicate: boolean;
}

export interface SendNowRepo {
  /** `offers`: upsert por (conta, item). Devolve o `offer_id` interno. */
  saveOffer(accountId: string, offer: OfferCandidate): Promise<string>;
  /**
   * Espelha a RPC `enqueue_send_now(group_id, offer_id)` (decisão 001 M2): valida posse, força
   * `queued` e prioridade 100, chave de idempotência por clique. A UI não envia status nem prioridade.
   */
  enqueueSendNow(accountId: string, groupId: string, offerId: string): Promise<EnqueueResult>;
  /** Envios `sent` do item nos grupos desde `since` (só para avisar repetição; não bloqueia). */
  recentSent(accountId: string, itemId: string, groupIds: string[], since: Date): Promise<{ groupId: string; at: Date }[]>;
}
