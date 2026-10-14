import { MemoryConnections } from "../src/server/memory";
import { MemorySendNow } from "../src/server/memory-sends";
import type { OfferCandidate, OfferFinder, ShortLinkGateway } from "../src/server/send-ports";

export const CANDIDATES: OfferCandidate[] = [
  {
    itemId: "1001", title: "Fone Bluetooth <script>alert(1)</script>", imageUrl: "https://down-br.img.susercontent.com/a.jpg",
    productLink: "https://shopee.com.br/product/10/1001", offerLink: "https://shopee.com.br/product/10/1001?aff=1",
    price: 99.9, oldPrice: 189.9, commissionRate: 8, rating: 4.8, sales: 12400, shopName: "Loja A",
  },
  {
    itemId: "1002", title: "Carregador 33W", imageUrl: "https://down-br.img.susercontent.com/b.jpg",
    productLink: "https://shopee.com.br/product/10/1002", offerLink: "https://shopee.com.br/product/10/1002?aff=1",
    price: 34.9, oldPrice: 59.9, commissionRate: 5, rating: 4.9, sales: 21700, shopName: "Loja B",
  },
];

export function fakeFinder(extra: OfferCandidate[] = []): OfferFinder & { calls: string[] } {
  const all = [...CANDIDATES, ...extra];
  const calls: string[] = [];
  return {
    calls,
    async search(_a, keyword) { calls.push(`search:${keyword}`); return all; },
    async byItemId(_a, itemId) { calls.push(`item:${itemId}`); return all.find((c) => c.itemId === itemId) ?? null; },
    async resolveShortUrl(_a, url) { calls.push(`short:${url}`); return all[0] ?? null; },
  };
}

export function fakeLinks(): ShortLinkGateway & { calls: { originUrl: string; subIds: string[] }[] } {
  const calls: { originUrl: string; subIds: string[] }[] = [];
  return {
    calls,
    async generate(_a, originUrl, subIds) { calls.push({ originUrl, subIds }); return "https://s.shopee.com.br/demo123"; },
  };
}

export async function buildSend(accountId: string | null = "acc_A", now = () => new Date("2026-10-14T12:00:30Z")) {
  const connections = new MemoryConnections();
  const sends = new MemorySendNow(connections, now);
  const finder = fakeFinder();
  const links = fakeLinks();
  const groupsA = await connections.syncGroups("acc_A", [
    { chatId: "-1001", name: "Grupo Tech", chatType: "supergroup", members: 10 },
    { chatId: "-1002", name: "Canal Casa", chatType: "channel", members: 5 },
  ]);
  const groupsB = await connections.syncGroups("acc_B", [{ chatId: "-2001", name: "Grupo B", chatType: "supergroup", members: 3 }]);
  await connections.setGroupActive("acc_A", groupsA[0]!.id, true);
  await connections.setGroupActive("acc_B", groupsB[0]!.id, true);
  return { connections, sends, finder, links, groupsA, groupsB, accountId, deps: { connections, sends, finder, links, now } };
}
