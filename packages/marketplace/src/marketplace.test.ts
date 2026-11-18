import { describe, expect, it } from "vitest";
import { FakeAdapter } from "./fake.ts";
import { comLimite, type FalhaMarketplace } from "./limite.ts";
import { MercadoLivreAdapter } from "./mercadolivre.ts";
import { assinarShopee, ShopeeAdapter } from "./shopee.ts";
import { ErroMarketplace } from "./tipos.ts";

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });

const NO = {
  itemId: 23456789012,
  productName: " Kit potes ",
  productLink: "https://shopee.com.br/produto-i.1.23456789012",
  offerLink: "https://s.shopee.com.br/abc",
  imageUrl: "https://cf.shopee.com.br/x.jpg",
  priceMin: "39.90",
  priceMax: "45.00",
  priceDiscountRate: 30,
  sales: 1200,
  ratingStar: "4.8",
  commissionRate: "0.08",
  commission: "3.19",
  shopId: 555,
  shopName: "Loja",
};

function shopeeCom(
  resposta: (corpo: string) => Response,
  extra: Partial<ConstructorParameters<typeof ShopeeAdapter>[0]> = {},
) {
  const pedidos: { url: string; init: RequestInit }[] = [];
  const a = new ShopeeAdapter({
    appId: "123",
    secret: "segredo",
    agora: () => 1_700_000_000_000,
    fetch: (async (url: string, init: RequestInit) => {
      pedidos.push({ url, init });
      return resposta(String(init.body));
    }) as typeof fetch,
    ...extra,
  });
  return { a, pedidos };
}

describe("ShopeeAdapter", () => {
  it("assina o corpo exato e usa argumentos inline, sem variables", async () => {
    const { a, pedidos } = shopeeCom(() => json({ data: { productOfferV2: { nodes: [NO] } } }));
    const r = await a.buscar('pote "hermético"', { limite: 20, pagina: 2 });
    const p = pedidos[0];
    if (!p) throw new Error("sem pedido");
    const corpo = String(p.init.body);
    expect(JSON.parse(corpo)).not.toHaveProperty("variables");
    expect(JSON.parse(corpo).query).toContain(
      'keyword: "pote \\"hermético\\"", sortType: 1, page: 2, limit: 20',
    );
    const h = (p.init.headers as Record<string, string>).authorization;
    expect(h).toBe(
      `SHA256 Credential=123, Timestamp=1700000000, Signature=${assinarShopee("123", 1700000000, corpo, "segredo")}`,
    );
    expect(p.init.redirect).toBe("manual");
    expect(r).toEqual([
      expect.objectContaining({
        marketplace: "shopee",
        idExterno: "23456789012",
        nome: "Kit potes",
        preco: 39.9,
        precoMax: 45,
        descontoAnunciado: 0.3,
        avaliacao: 4.8,
        comissaoTaxa: 0.08,
        lojaId: "555",
        linkAfiliado: "https://s.shopee.com.br/abc",
      }),
    ]);
  });

  it("filtra por faixa de preço e descarta nós incompletos", async () => {
    const { a } = shopeeCom(() =>
      json({
        data: {
          productOfferV2: { nodes: [NO, { ...NO, itemId: 2, priceMin: "99" }, { productName: "sem id" }] },
        },
      }),
    );
    const r = await a.buscar("x", { precoMax: 50 });
    expect(r.map((p) => p.idExterno)).toEqual(["23456789012"]);
  });

  it("detalhe consulta pelo itemId (e shopId quando conhecido)", async () => {
    const { a, pedidos } = shopeeCom(() => json({ data: { productOfferV2: { nodes: [NO] } } }));
    expect(await a.detalhe("23456789012", { lojaId: "555" })).toMatchObject({ preco: 39.9 });
    expect(JSON.parse(String(pedidos[0]?.init.body)).query).toContain("shopId: 555, itemId: 23456789012");
    await expect(a.detalhe("1 OR 1")).rejects.toThrow(/itemId/);
  });

  it("gera link curto com no máximo 5 subIds alfanuméricos", async () => {
    const { a, pedidos } = shopeeCom(() =>
      json({ data: { generateShortLink: { shortLink: "https://s.shopee.com.br/xyz" } } }),
    );
    expect(await a.gerarLinkAfiliado(NO.productLink, ["g-1", "n 2", "o3", "h0900"])).toBe(
      "https://s.shopee.com.br/xyz",
    );
    expect(JSON.parse(String(pedidos[0]?.init.body)).query).toContain('subIds: ["g1","n2","o3","h0900"]');
    await expect(a.gerarLinkAfiliado(NO.productLink, ["1", "2", "3", "4", "5", "6"])).rejects.toThrow(
      /5 subIds/,
    );
  });

  it("classifica erros: limite de taxa é recuperável, assinatura não", async () => {
    const taxa = shopeeCom(() => json({ errors: [{ message: "x", extensions: { code: 10030 } }] }));
    await expect(taxa.a.buscar("x")).rejects.toMatchObject({ codigo: "LIMITE_TAXA", recuperavel: true });
    const ass = shopeeCom(() => json({ errors: [{ message: "x", extensions: { code: 10020 } }] }));
    await expect(ass.a.buscar("x")).rejects.toMatchObject({
      codigo: "ASSINATURA_INVALIDA",
      recuperavel: false,
    });
    const http = shopeeCom(() => new Response("oops", { status: 503 }));
    await expect(http.a.buscar("x")).rejects.toMatchObject({ codigo: "HTTP", recuperavel: true });
    const redir = shopeeCom(() => new Response(null, { status: 302 }));
    await expect(redir.a.buscar("x")).rejects.toMatchObject({ codigo: "REDIRECIONAMENTO" });
  });

  it("recusa endpoint fora da Shopee antes de assinar e não vaza o Secret", () => {
    expect(
      () => new ShopeeAdapter({ appId: "1", secret: "s", endpoint: "https://evil.example/graphql" }),
    ).toThrow(/shopee/);
    expect(
      () =>
        new ShopeeAdapter({
          appId: "1",
          secret: "s",
          endpoint: "http://open-api.affiliate.shopee.com.br/graphql",
        }),
    ).toThrow();
    const a = new ShopeeAdapter({
      appId: "1",
      secret: "nao-pode-vazar",
      endpoint: "http://127.0.0.1:9/graphql",
    });
    expect(JSON.stringify(a)).not.toContain("nao-pode-vazar");
  });
});

describe("comLimite", () => {
  it("repete erro recuperável com espera crescente e avisa cada falha", async () => {
    const falhas: FalhaMarketplace[] = [];
    const esperas: number[] = [];
    const fake = new FakeAdapter();
    let n = 0;
    fake.buscar = async () => {
      n++;
      if (n < 3) throw new ErroMarketplace("fora", "REDE", true);
      return [];
    };
    const a = comLimite(fake, {
      porMinuto: 600,
      tentativas: 3,
      esperaBaseMs: 100,
      aleatorio: () => 0.5,
      dormir: async (ms) => {
        esperas.push(ms);
      },
      aoErro: (f) => {
        falhas.push(f);
      },
    });
    await a.buscar("x");
    expect(n).toBe(3);
    expect(falhas.map((f) => [f.tentativa, f.vaiTentarDeNovo])).toEqual([
      [1, true],
      [2, true],
    ]);
    expect(esperas).toEqual([100, 200]);
  });

  it("não repete erro definitivo e desiste depois do limite de tentativas", async () => {
    const fake = new FakeAdapter();
    let n = 0;
    fake.detalhe = async () => {
      n++;
      throw new ErroMarketplace("assinatura", "ASSINATURA_INVALIDA", false);
    };
    const a = comLimite(fake, { porMinuto: 600, dormir: async () => {} });
    await expect(a.detalhe("1")).rejects.toThrow("assinatura");
    expect(n).toBe(1);
  });

  it("respeita o limite por minuto", async () => {
    let t = 0;
    const esperas: number[] = [];
    const a = comLimite(new FakeAdapter(), {
      porMinuto: 2,
      agora: () => t,
      dormir: async (ms) => {
        esperas.push(ms);
        t += ms;
      },
    });
    await Promise.all([a.buscar("pote"), a.buscar("pote"), a.buscar("pote")]);
    expect(esperas).toEqual([30_000]);
  });
});

describe("FakeAdapter e Mercado Livre", () => {
  it("busca por palavra e aceita preço forçado", async () => {
    const f = new FakeAdapter();
    expect((await f.buscar("pote")).map((p) => p.idExterno)).toEqual(["9001", "9006"]);
    f.definirPreco("9001", 35);
    expect(await f.detalhe("9001")).toMatchObject({ preco: 35 });
  });
  it("Mercado Livre responde 501 (fase 2)", async () => {
    await expect(new MercadoLivreAdapter().buscar()).rejects.toMatchObject({
      status: 501,
      codigo: "NAO_IMPLEMENTADO",
    });
  });
});
