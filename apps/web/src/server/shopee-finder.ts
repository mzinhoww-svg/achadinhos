import "server-only";
import type { ShopeeClient } from "@achadinhos/shopee";
import type { OfferCandidate, OfferFinder, ShortLinkGateway } from "./send-ports";

/**
 * Resolve o cliente Shopee da conta. A web não lê o Secret (decisão 003 H1): quem implementa isto roda onde a
 * credencial vive (worker / endpoint interno). Devolver `null` = conta sem credencial validada.
 */
export type ShopeeClientProvider = (accountId: string) => Promise<ShopeeClient | null>;

async function need(provider: ShopeeClientProvider, accountId: string) {
  const c = await provider(accountId);
  if (!c) throw new Error("Conta sem credencial Shopee validada.");
  return c;
}

type Node = Awaited<ReturnType<ShopeeClient["productOfferV2"]>>["nodes"][number];

function toCandidate(n: Node): OfferCandidate {
  const rate = Number(n.priceDiscountRate);
  const price = n.priceMin;
  const oldPrice = rate > 0 && rate < 100 ? Math.round((price / (1 - rate / 100)) * 100) / 100 : price;
  return {
    itemId: String(n.itemId),
    title: n.productName,
    imageUrl: n.imageUrl,
    productLink: n.productLink,
    offerLink: n.offerLink,
    price,
    oldPrice,
    commissionRate: Math.round(Number(n.commissionRate) * 10_000) / 100,
    rating: n.ratingStar,
    sales: n.sales,
    shopName: n.shopName,
  };
}

export function createShopeeFinder(provider: ShopeeClientProvider): OfferFinder {
  return {
    async search(accountId, keyword) {
      const r = await (await need(provider, accountId)).productOfferV2({ keyword, limit: 10, sortType: 2 });
      return r.nodes.map(toCandidate);
    },
    async byItemId(accountId, itemId) {
      const r = await (await need(provider, accountId)).productOfferV2({ itemId: Number(itemId), limit: 1 });
      const n = r.nodes.find((x) => String(x.itemId) === itemId) ?? r.nodes[0];
      return n ? toCandidate(n) : null;
    },
    async resolveShortUrl() {
      // Seguir link curto exige requisição a host de terceiro (SSRF): fica para o adaptador do worker, com allowlist.
      return null;
    },
  };
}

export function createShopeeLinks(provider: ShopeeClientProvider): ShortLinkGateway {
  return {
    async generate(accountId, originUrl, subIds) {
      const r = await (await need(provider, accountId)).generateShortLink({ originUrl, subIds });
      return r.shortLink;
    },
  };
}
