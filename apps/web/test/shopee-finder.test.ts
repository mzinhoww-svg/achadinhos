import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startMockServer, ShopeeClient } from "@achadinhos/shopee";
import { createShopeeFinder, createShopeeLinks } from "@/server/shopee-finder";

let mock: Awaited<ReturnType<typeof startMockServer>>;
beforeAll(async () => {
  mock = await startMockServer({ appId: "app-1", secret: "mock-secret-123456" });
});
afterAll(async () => mock.close());

const client = () => new ShopeeClient({ appId: "app-1", secret: "mock-secret-123456" }, { endpoint: mock.url, timeoutMs: 2000 });

describe("adaptador Shopee (servidor simulado)", () => {
  it("mapeia productOfferV2 para OfferCandidate (comissão em %, preço antigo derivado)", async () => {
    const f = createShopeeFinder(async () => client());
    const [c] = await f.search("acc", "teste");
    expect(c).toMatchObject({ itemId: "900001", price: 19.9, commissionRate: 12, shopName: "Loja Teste" });
    expect(c!.oldPrice).toBeCloseTo(19.9 / 0.85, 2);
  });
  it("byItemId e link curto passam pelo mesmo cliente com timeout", async () => {
    const f = createShopeeFinder(async () => client());
    expect((await f.byItemId("acc", "900001"))?.itemId).toBe("900001");
    const l = createShopeeLinks(async () => client());
    expect(await l.generate("acc", "https://shopee.com.br/produto-teste-i.1.900001", ["acc", "manual"])).toBe("https://shope.ee/mockshort1");
  });
  it("conta sem credencial: erro claro, sem chamar a rede", async () => {
    const f = createShopeeFinder(async () => null);
    await expect(f.search("acc", "x")).rejects.toThrow(/credencial/i);
  });
});
