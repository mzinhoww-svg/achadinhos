import type { ProductOfferNode } from "../../src/scheduler-ports.js";

export const CUIABA = "America/Cuiaba";

export function node(overrides: Partial<ProductOfferNode> = {}): ProductOfferNode {
  return {
    itemId: 1001,
    productName: "Fone Bluetooth",
    productLink: "https://shopee.com.br/p/1001",
    offerLink: "https://shope.ee/1001",
    imageUrl: "https://img/1001.jpg",
    priceMin: 50,
    priceMax: 50,
    priceDiscountRate: 30,
    sales: 500,
    ratingStar: 4.8,
    commissionRate: "0.10",
    sellerCommissionRate: "0.05",
    shopeeCommissionRate: "0.05",
    commission: "5",
    shopId: 7,
    shopName: "Loja",
    shopType: 1,
    periodStartTime: 0,
    periodEndTime: 0,
    ...overrides,
  };
}
