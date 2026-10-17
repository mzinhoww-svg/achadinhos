import type { Channel } from "@achadinhos/channel";
import type { OfferSource } from "../offer-selection.js";
import type { ProductOfferNode } from "../scheduler-ports.js";

export type { Channel, OfferSource, ProductOfferNode };

/** Encurtador da Shopee: `generateShortLink`. `subIds` internos (<= 5). */
export interface ShortLinker {
  generateShortLink(params: { originUrl: string; subIds: string[] }): Promise<{ shortLink: string }>;
}

/** Imagem já baixada pelo downloader seguro (`image.ts`). */
export interface FetchedImage {
  bytes: Uint8Array;
  mime: string;
}

export type ImageFetcher = (imageUrl: string) => Promise<FetchedImage>;

export interface RenderCreativeInput {
  title: string;
  image: FetchedImage;
  priceCurrent: number;
  priceOld: number;
  discountPct: number;
  affiliateHandle: string;
}

/** Renderiza o criativo 1080x1080 a partir da imagem baixada. */
export type RenderCreative = (input: RenderCreativeInput) => Promise<Uint8Array>;
