import { ErroNaoImplementado, type MarketplaceAdapter, type ProdutoMarketplace } from "./tipos.ts";

const MOTIVO = "Mercado Livre entra na fase 2 (API com aplicativo próprio). O piloto usa só a Shopee.";

/** Fase 2: só a interface. Toda chamada responde 501 com o motivo (capacidade 9 do contrato). */
export class MercadoLivreAdapter implements MarketplaceAdapter {
  readonly nome = "mercadolivre" as const;
  async buscar(): Promise<ProdutoMarketplace[]> {
    throw new ErroNaoImplementado(MOTIVO);
  }
  async detalhe(): Promise<ProdutoMarketplace | null> {
    throw new ErroNaoImplementado(MOTIVO);
  }
  async gerarLinkAfiliado(): Promise<string> {
    throw new ErroNaoImplementado(MOTIVO);
  }
}
