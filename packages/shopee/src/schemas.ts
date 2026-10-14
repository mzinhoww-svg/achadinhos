import { z } from "zod";

const stringOrNumber = z.union([z.string(), z.number()]);

export const ProductOfferV2NodeSchema = z.object({
  itemId: z.number(),
  productName: z.string(),
  productLink: z.string(),
  offerLink: z.string(),
  imageUrl: z.string(),
  priceMin: z.number(),
  priceMax: z.number(),
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
    shortLink: z.string(),
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
