/**
 * Contrato do canal de entrega — plano `docs/plans/escopo-sem-supabase-telegram.md` §1.
 * O pacote não depende de Shopee, Telegram nem de banco: recebe uma oferta pronta e confirma a entrega.
 */

/** Identidade do envio. É a MESMA coisa que o nome do arquivo (B1): nada mais entra no caminho. */
export interface Slot {
  /** AAAAMMDD, fuso America/Cuiaba, calculado UMA vez por execução (pelo gerador, nunca pelo canal). */
  day: string;
  /** HHMM, mesmo relógio e mesmo instante (início da execução). */
  hhmm: string;
  /** 1..99, posição do grupo na configuração; nunca o rótulo externo. */
  groupIndex: number;
}

export interface OutboundOffer {
  slot: Slot;
  /** Só dígitos (`^[0-9]{1,20}$`). */
  itemId: string;
  /** Dado externo (título da Shopee): nunca vira nome de arquivo. */
  title: string;
  /** Mensagem pronta; também dado externo. */
  text: string;
  /** https, host em `AFFILIATE_LINK_HOSTS`. */
  affiliateLink: string;
  /** Finitos, >= 0; `discountPct <= 100`. */
  priceCurrent: number;
  priceOld: number;
  discountPct: number;
  /** 1080x1080, <= `MAX_CREATIVE_PNG_BYTES`, com assinatura PNG. */
  creativePng: Uint8Array;
  /** ISO 8601 UTC; só dentro do front matter. */
  generatedAtUtc: string;
  /** Rótulo de exibição; nunca em caminho. */
  groupLabel: string;
}

export type DeliveryResult =
  /** `ref`: caminho relativo (FileOutbox) ou id da mensagem (WhatsApp). */
  | { status: "delivered"; ref: string }
  /** Nada confirmado; código fixo, nunca mensagem de erro. */
  | { status: "failed"; code: string }
  /** Pode ter entregue (timeout); NUNCA reenviar sozinho. */
  | { status: "unknown"; code: string };

export interface Channel {
  readonly kind: "file-outbox" | "whatsapp";
  deliver(offer: OutboundOffer, opts: { signal: AbortSignal }): Promise<DeliveryResult>;
}
