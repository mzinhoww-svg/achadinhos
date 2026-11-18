/** Contrato comum dos marketplaces (pacote/CONTRATO.md: coleta). */

export type Marketplace = "shopee" | "mercadolivre" | "fake";

/** Produto normalizado, igual para todos os marketplaces. Valores em reais; taxas de 0 a 1. */
export interface ProdutoMarketplace {
  marketplace: Marketplace;
  idExterno: string;
  lojaId: string | null;
  lojaNome: string | null;
  nome: string;
  /** Página do produto, sem afiliação. */
  url: string;
  /** Link de afiliado que o marketplace já devolve na busca (na Shopee, `offerLink`). */
  linkAfiliado: string | null;
  fotoUrl: string | null;
  /** Menor preço atual (variações). */
  preco: number;
  precoMax: number | null;
  /** Desconto anunciado pela loja (0 a 1). Não é o desconto real: esse vem do histórico. */
  descontoAnunciado: number | null;
  avaliacao: number | null;
  vendas: number | null;
  comissaoTaxa: number | null;
  comissaoValor: number | null;
  /** null quando o marketplace não informa. */
  emEstoque: boolean | null;
}

export interface FiltrosBusca {
  precoMin?: number | null;
  precoMax?: number | null;
  pagina?: number;
  /** Itens por página (a Shopee aceita até 50). */
  limite?: number;
}

export interface MarketplaceAdapter {
  readonly nome: Marketplace;
  buscar(palavra: string, filtros?: FiltrosBusca): Promise<ProdutoMarketplace[]>;
  /** null quando o produto não existe mais. */
  detalhe(idExterno: string): Promise<ProdutoMarketplace | null>;
  /** Link curto de afiliado com subIds (grupo, nicho, oferta, horário: capacidade 13). */
  gerarLinkAfiliado(url: string, subIds?: string[]): Promise<string>;
  /** Relatório de conversões (pedidos atribuídos aos links de afiliado) entre duas datas. */
  conversoes?(desde: Date, ate: Date): Promise<ConversaoMarketplace[]>;
}

/** Uma conversão (um pedido) com os subIds do link que a trouxe. */
export interface ConversaoMarketplace {
  /** Id único do pedido no marketplace (Shopee: conversionId:orderId). */
  pedido: string;
  subIds: string[];
  valor: number;
  comissao: number;
  status: string;
  compradoEm: Date;
}

/**
 * Erro de marketplace. `recuperavel` diz se vale tentar de novo (rede, 5xx, limite de taxa).
 * A mensagem nunca carrega credencial, assinatura nem corpo bruto da resposta.
 */
export class ErroMarketplace extends Error {
  constructor(
    message: string,
    readonly codigo: string,
    readonly recuperavel: boolean,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "ErroMarketplace";
  }
}

/** Ferramenta prevista mas não construída (o worker devolve 501). */
export class ErroNaoImplementado extends ErroMarketplace {
  constructor(message: string) {
    super(message, "NAO_IMPLEMENTADO", false, 501);
    this.name = "ErroNaoImplementado";
  }
}

export function filtrarPorPreco(lista: ProdutoMarketplace[], f: FiltrosBusca = {}): ProdutoMarketplace[] {
  return lista.filter(
    (p) => (f.precoMin == null || p.preco >= f.precoMin) && (f.precoMax == null || p.preco <= f.precoMax),
  );
}
