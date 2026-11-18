import { createHash } from "node:crypto";
import {
  ErroMarketplace,
  type FiltrosBusca,
  filtrarPorPreco,
  type MarketplaceAdapter,
  type ProdutoMarketplace,
} from "./tipos.ts";

/**
 * Open API de Afiliados da Shopee Brasil (GraphQL), assinada com App ID e Secret.
 *
 * Assinatura: header `Authorization: SHA256 Credential=<appId>, Timestamp=<unix s>, Signature=<hex>`, com
 * Signature = sha256(appId + timestamp + corpo + secret), sobre o corpo exato enviado.
 *
 * O documento usa argumentos inline, sem `variables`. A versão anterior do projeto declarava variáveis
 * tipadas (ex.: `$itemId: Int`) e recebia o erro 10010 (parse) da API real; o itemId da Shopee é Int64.
 * Strings vão escapadas com JSON.stringify, que gera literais GraphQL válidos.
 */

export const SHOPEE_ENDPOINT = "https://open-api.affiliate.shopee.com.br/graphql";

/** sortType do productOfferV2: 1 relevância, 2 mais vendidos, 3 maior preço, 4 menor preço, 5 maior comissão. */
export type OrdemShopee = 1 | 2 | 3 | 4 | 5;

export interface OpcoesShopee {
  appId: string;
  secret: string;
  endpoint?: string;
  timeoutMs?: number;
  ordem?: OrdemShopee;
  fetch?: typeof fetch;
  agora?: () => number;
}

const CAMPOS_PRODUTO = `itemId productName productLink offerLink imageUrl priceMin priceMax priceDiscountRate
  sales ratingStar commissionRate commission shopId shopName`;
const LIMITE_CORPO = 2 * 1024 * 1024;
const HOSTS_LOCAIS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** Códigos de erro da Open API: 10030 é limite de taxa e 10000 é erro do sistema (vale tentar de novo). */
const CODIGOS_RECUPERAVEIS = new Set(["10000", "10030"]);
const NOMES_CODIGO: Record<string, string> = {
  "10000": "ERRO_SISTEMA",
  "10010": "CONSULTA_RECUSADA",
  "10020": "ASSINATURA_INVALIDA",
  "10030": "LIMITE_TAXA",
  "10031": "ACESSO_NEGADO",
  "10035": "SEM_ACESSO_OPEN_API",
};

export function assinarShopee(appId: string, timestamp: number, corpo: string, secret: string): string {
  return createHash("sha256").update(`${appId}${timestamp}${corpo}${secret}`).digest("hex");
}

/** Só https em *.shopee.com.br (http apenas no loopback, para o servidor simulado). Conferido antes de assinar. */
function validarEndpoint(endpoint: string): string {
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    throw new ErroMarketplace("endpoint da Shopee inválido", "ENDPOINT", false);
  }
  const host = u.hostname.toLowerCase();
  if (u.username || u.password)
    throw new ErroMarketplace("endpoint com credencial embutida", "ENDPOINT", false);
  if (HOSTS_LOCAIS.has(host)) return endpoint;
  if (u.protocol !== "https:" || !host.endsWith(".shopee.com.br")) {
    throw new ErroMarketplace("endpoint fora de *.shopee.com.br", "ENDPOINT", false);
  }
  return endpoint;
}

const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};

interface NoShopee {
  itemId?: unknown;
  productName?: unknown;
  productLink?: unknown;
  offerLink?: unknown;
  imageUrl?: unknown;
  priceMin?: unknown;
  priceMax?: unknown;
  priceDiscountRate?: unknown;
  sales?: unknown;
  ratingStar?: unknown;
  commissionRate?: unknown;
  commission?: unknown;
  shopId?: unknown;
  shopName?: unknown;
}

/** Normaliza um nó do productOfferV2. Devolve null quando faltam id, nome, link ou preço. */
export function normalizarNoShopee(n: NoShopee): ProdutoMarketplace | null {
  const id = typeof n.itemId === "number" || typeof n.itemId === "string" ? String(n.itemId) : null;
  const preco = num(n.priceMin);
  const url = typeof n.productLink === "string" ? n.productLink : null;
  if (!id || !/^\d+$/.test(id) || typeof n.productName !== "string" || !url || preco === null) return null;
  // priceDiscountRate vem em pontos percentuais (ex.: 30 = 30%).
  const desc = num(n.priceDiscountRate);
  return {
    marketplace: "shopee",
    idExterno: id,
    lojaId: n.shopId == null ? null : String(n.shopId),
    lojaNome: typeof n.shopName === "string" ? n.shopName : null,
    nome: n.productName.trim(),
    url,
    linkAfiliado: typeof n.offerLink === "string" ? n.offerLink : null,
    fotoUrl: typeof n.imageUrl === "string" ? n.imageUrl : null,
    preco,
    precoMax: num(n.priceMax),
    descontoAnunciado: desc === null ? null : desc > 1 ? desc / 100 : desc,
    avaliacao: num(n.ratingStar),
    vendas: num(n.sales),
    comissaoTaxa: num(n.commissionRate),
    comissaoValor: num(n.commission),
    // A busca de afiliados só lista itens à venda; o estoque exato não vem na API.
    emEstoque: true,
  };
}

export class ShopeeAdapter implements MarketplaceAdapter {
  readonly nome = "shopee" as const;
  readonly #appId: string;
  readonly #secret: string;
  readonly #endpoint: string;
  readonly #timeoutMs: number;
  readonly #ordem: OrdemShopee;
  readonly #fetch: typeof fetch;
  readonly #agora: () => number;

  constructor(o: OpcoesShopee) {
    if (!o.appId || !o.secret)
      throw new ErroMarketplace("SHOPEE_APP_ID e SHOPEE_SECRET são obrigatórios", "CONFIG", false);
    this.#appId = o.appId;
    this.#secret = o.secret;
    this.#endpoint = validarEndpoint(o.endpoint ?? SHOPEE_ENDPOINT);
    this.#timeoutMs = o.timeoutMs ?? 20_000;
    this.#ordem = o.ordem ?? 1;
    this.#fetch = o.fetch ?? fetch;
    this.#agora = o.agora ?? Date.now;
  }

  /** Nunca expõe o Secret em logs ou JSON. */
  toJSON() {
    return { nome: this.nome, appId: this.#appId, secret: "[oculto]" };
  }

  async buscar(palavra: string, f: FiltrosBusca = {}): Promise<ProdutoMarketplace[]> {
    const pagina = Math.max(1, Math.trunc(f.pagina ?? 1));
    const limite = Math.min(50, Math.max(1, Math.trunc(f.limite ?? 50)));
    const q = `{ productOfferV2(keyword: ${JSON.stringify(palavra)}, sortType: ${this.#ordem}, page: ${pagina}, limit: ${limite}) { nodes { ${CAMPOS_PRODUTO} } pageInfo { page limit hasNextPage } } }`;
    const dados = (await this.#consultar(q)) as { productOfferV2?: { nodes?: NoShopee[] } };
    const nos = dados.productOfferV2?.nodes ?? [];
    return filtrarPorPreco(
      nos.map(normalizarNoShopee).filter((p): p is ProdutoMarketplace => p !== null),
      f,
    );
  }

  async detalhe(
    idExterno: string,
    contexto?: { lojaId?: string | null },
  ): Promise<ProdutoMarketplace | null> {
    if (!/^\d+$/.test(idExterno)) throw new ErroMarketplace("itemId inválido", "ENTRADA", false);
    const loja = contexto?.lojaId && /^\d+$/.test(contexto.lojaId) ? `shopId: ${contexto.lojaId}, ` : "";
    const q = `{ productOfferV2(${loja}itemId: ${idExterno}, page: 1, limit: 1) { nodes { ${CAMPOS_PRODUTO} } } }`;
    const dados = (await this.#consultar(q)) as { productOfferV2?: { nodes?: NoShopee[] } };
    const no = dados.productOfferV2?.nodes?.[0];
    return no ? normalizarNoShopee(no) : null;
  }

  async gerarLinkAfiliado(url: string, subIds: string[] = []): Promise<string> {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      throw new ErroMarketplace("URL de origem inválida", "ENTRADA", false);
    }
    if (u.protocol !== "https:")
      throw new ErroMarketplace("URL de origem precisa ser https", "ENTRADA", false);
    if (subIds.length > 5) throw new ErroMarketplace("no máximo 5 subIds", "ENTRADA", false);
    // A Shopee aceita subId alfanumérico (sem espaço nem símbolo).
    const limpos = subIds.map((s) => s.replace(/[^A-Za-z0-9]/g, "").slice(0, 50));
    const q = `mutation { generateShortLink(input: { originUrl: ${JSON.stringify(url)}, subIds: ${JSON.stringify(limpos)} }) { shortLink } }`;
    const dados = (await this.#consultar(q)) as { generateShortLink?: { shortLink?: unknown } };
    const link = dados.generateShortLink?.shortLink;
    if (typeof link !== "string" || !link.startsWith("https://")) {
      throw new ErroMarketplace("resposta sem shortLink", "RESPOSTA", false);
    }
    return link;
  }

  async #consultar(query: string): Promise<unknown> {
    const corpo = JSON.stringify({ query });
    const ts = Math.floor(this.#agora() / 1000);
    const assinatura = assinarShopee(this.#appId, ts, corpo, this.#secret);
    const controle = new AbortController();
    const timer = setTimeout(() => controle.abort(), this.#timeoutMs);
    let res: Response;
    try {
      res = await this.#fetch(this.#endpoint, {
        method: "POST",
        // Não segue redirecionamento: levaria o header assinado a outro host.
        redirect: "manual",
        signal: controle.signal,
        headers: {
          "content-type": "application/json",
          authorization: `SHA256 Credential=${this.#appId}, Timestamp=${ts}, Signature=${assinatura}`,
        },
        body: corpo,
      });
    } catch (e) {
      const tempo = e instanceof Error && e.name === "AbortError";
      throw new ErroMarketplace(
        tempo ? "Shopee não respondeu a tempo" : "falha de rede com a Shopee",
        tempo ? "TEMPO" : "REDE",
        true,
      );
    } finally {
      clearTimeout(timer);
    }
    if (res.status >= 300 && res.status < 400) {
      throw new ErroMarketplace(
        "Shopee respondeu com redirecionamento",
        "REDIRECIONAMENTO",
        false,
        res.status,
      );
    }
    const texto = await res.text();
    if (texto.length > LIMITE_CORPO)
      throw new ErroMarketplace("resposta grande demais", "RESPOSTA", false, res.status);
    let json: { data?: unknown; errors?: { message?: string; extensions?: { code?: unknown } }[] } | null =
      null;
    try {
      json = JSON.parse(texto);
    } catch {
      json = null;
    }
    const erro = json?.errors?.[0];
    if (erro) {
      const codigo = String(erro.extensions?.code ?? "");
      throw new ErroMarketplace(
        `Shopee recusou a chamada (${NOMES_CODIGO[codigo] ?? `código ${/^\d{1,6}$/.test(codigo) ? codigo : "?"}`})`,
        NOMES_CODIGO[codigo] ?? "GRAPHQL",
        CODIGOS_RECUPERAVEIS.has(codigo),
        res.status,
      );
    }
    if (!res.ok) {
      throw new ErroMarketplace(
        `Shopee respondeu HTTP ${res.status}`,
        "HTTP",
        res.status === 429 || res.status >= 500,
        res.status,
      );
    }
    if (!json || typeof json.data !== "object" || json.data === null) {
      throw new ErroMarketplace("resposta da Shopee sem dados", "RESPOSTA", false, res.status);
    }
    return json.data;
  }
}
