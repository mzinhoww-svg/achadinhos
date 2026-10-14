import { z } from "zod";

const stringOrNumber = z.union([z.string(), z.number()]);

/** URL https não vazia; entra em mensagem pública ou download (auditoria R4). */
export const HttpsUrlSchema = z
  .string()
  .min(1)
  .url()
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password;
    } catch {
      return false;
    }
  }, "must be an https URL");

export const ProductOfferV2NodeSchema = z.object({
  itemId: z.number(),
  productName: z.string().min(1),
  productLink: HttpsUrlSchema,
  offerLink: HttpsUrlSchema,
  imageUrl: HttpsUrlSchema,
  priceMin: z.number().nonnegative(),
  priceMax: z.number().nonnegative(),
  priceDiscountRate: z.number(),
  sales: z.number(),
  ratingStar: z.number(),
  commissionRate: stringOrNumber,
  sellerCommissionRate: stringOrNumber,
  shopeeCommissionRate: stringOrNumber,
  commission: stringOrNumber,
  shopId: z.number(),
  shopName: z.string(),
  shopType: z.number(),
  periodStartTime: z.number(),
  periodEndTime: z.number(),
});

export type DiscardedNode = { index: number; fields: string[] };

/** Envelope da página: os nós são validados um a um (ver `parseOfferNodes`). */
export const ProductOfferV2RawResponseSchema = z.object({
  productOfferV2: z.object({
    nodes: z.array(z.unknown()),
    pageInfo: z.lazy(() => PageInfoSchema),
  }),
});

/**
 * Valida cada nó isoladamente: um inválido é descartado (só índice e nomes de
 * campo, nunca o conteúdo da resposta) sem derrubar nem deixar passar os demais.
 */
export function parseOfferNodes(raw: unknown[]): {
  nodes: z.infer<typeof ProductOfferV2NodeSchema>[];
  discarded: DiscardedNode[];
} {
  const nodes: z.infer<typeof ProductOfferV2NodeSchema>[] = [];
  const discarded: DiscardedNode[] = [];
  raw.forEach((item, index) => {
    const parsed = ProductOfferV2NodeSchema.safeParse(item);
    if (parsed.success) {
      nodes.push(parsed.data);
      return;
    }
    const fields = [
      ...new Set(
        parsed.error.issues.map((issue) => (typeof issue.path[0] === "string" ? issue.path[0] : "(node)")),
      ),
    ];
    discarded.push({ index, fields });
  });
  return { nodes, discarded };
}

export const PageInfoSchema = z.object({
  page: z.number().optional(),
  limit: z.number(),
  hasNextPage: z.boolean(),
  scrollId: z.string().optional(),
});

export const ProductOfferV2ResponseSchema = z.object({
  productOfferV2: z.object({
    nodes: z.array(ProductOfferV2NodeSchema),
    pageInfo: PageInfoSchema,
  }),
});

export const GenerateShortLinkResponseSchema = z.object({
  generateShortLink: z.object({
    shortLink: HttpsUrlSchema,
  }),
});

export const ConversionOrderItemSchema = z.object({
  itemId: z.number(),
  itemName: z.string(),
  shopName: z.string(),
  itemPrice: stringOrNumber,
  qty: z.number(),
  itemTotalCommission: stringOrNumber,
  attributionType: z.string(),
});

export const ConversionOrderSchema = z.object({
  orderId: stringOrNumber,
  orderStatus: z.string(),
  items: z.array(ConversionOrderItemSchema),
});

export const ConversionReportNodeSchema = z.object({
  purchaseTime: z.number(),
  clickTime: z.number(),
  conversionId: stringOrNumber,
  totalCommission: stringOrNumber,
  sellerCommission: stringOrNumber,
  shopeeCommissionCapped: stringOrNumber,
  buyerType: z.string(),
  device: z.string(),
  utmContent: z.string(),
  orders: z.array(ConversionOrderSchema),
});

export const ConversionReportResponseSchema = z.object({
  conversionReport: z.object({
    nodes: z.array(ConversionReportNodeSchema),
    pageInfo: z.object({
      limit: z.number(),
      hasNextPage: z.boolean(),
      scrollId: z.string(),
    }),
  }),
});

export type ProductOfferV2Params = {
  keyword?: string;
  shopId?: number;
  itemId?: number;
  listType?: number;
  sortType?: number;
  page?: number;
  limit?: number;
  isAMSOffer?: boolean;
  isKeySeller?: boolean;
};

export type GenerateShortLinkParams = {
  originUrl: string;
  subIds?: string[];
};

export type ConversionReportParams = {
  purchaseTimeStart?: number;
  purchaseTimeEnd?: number;
  orderStatus?: string;
  buyerType?: string;
  device?: string;
  scrollId?: string;
  limit?: number;
};

export type ProductOfferV2Result = z.infer<typeof ProductOfferV2ResponseSchema>;
export type GenerateShortLinkResult = z.infer<typeof GenerateShortLinkResponseSchema>;
export type ConversionReportResult = z.infer<typeof ConversionReportResponseSchema>;
