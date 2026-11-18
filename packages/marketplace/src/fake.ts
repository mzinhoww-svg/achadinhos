import {
  type FiltrosBusca,
  filtrarPorPreco,
  type MarketplaceAdapter,
  type ProdutoMarketplace,
} from "./tipos.ts";

/**
 * Marketplace falso, com dados fixos, para testes e para o ensaio sem a API real.
 * `definirPreco` força um preço (ex.: uma queda) para testar a detecção de oferta.
 */

const BASE: Omit<ProdutoMarketplace, "marketplace" | "linkAfiliado" | "url" | "fotoUrl">[] = [
  {
    idExterno: "9001",
    lojaId: "77",
    lojaNome: "Casa Fácil",
    nome: "Kit 6 potes herméticos 520 ml",
    preco: 59.9,
    precoMax: 59.9,
    descontoAnunciado: 0.1,
    avaliacao: 4.8,
    vendas: 2300,
    comissaoTaxa: 0.08,
    comissaoValor: 4.79,
    emEstoque: true,
  },
  {
    idExterno: "9002",
    lojaId: "77",
    lojaNome: "Casa Fácil",
    nome: "Organizador de gaveta 8 divisórias",
    preco: 24.9,
    precoMax: 24.9,
    descontoAnunciado: null,
    avaliacao: 4.6,
    vendas: 980,
    comissaoTaxa: 0.07,
    comissaoValor: 1.74,
    emEstoque: true,
  },
  {
    idExterno: "9003",
    lojaId: "81",
    lojaNome: "Luz & Lar",
    nome: "Luminária LED de mesa recarregável",
    preco: 48.0,
    precoMax: 52.0,
    descontoAnunciado: 0.05,
    avaliacao: 4.7,
    vendas: 1500,
    comissaoTaxa: 0.1,
    comissaoValor: 4.8,
    emEstoque: true,
  },
  {
    idExterno: "9004",
    lojaId: "81",
    lojaNome: "Luz & Lar",
    nome: "Fita LED 5 m com controle",
    preco: 39.9,
    precoMax: 39.9,
    descontoAnunciado: null,
    avaliacao: 4.2,
    vendas: 40,
    comissaoTaxa: 0.06,
    comissaoValor: 2.39,
    emEstoque: true,
  },
  {
    idExterno: "9005",
    lojaId: "90",
    lojaNome: "Banho Bom",
    nome: "Jogo de toalhas 4 peças algodão",
    preco: 74.9,
    precoMax: 74.9,
    descontoAnunciado: 0.15,
    avaliacao: 4.9,
    vendas: 640,
    comissaoTaxa: 0.09,
    comissaoValor: 6.74,
    emEstoque: true,
  },
  {
    idExterno: "9006",
    lojaId: "90",
    lojaNome: "Banho Bom",
    nome: "Porta-temperos giratório 12 potes",
    preco: 79.9,
    precoMax: 79.9,
    descontoAnunciado: null,
    avaliacao: 4.5,
    vendas: 310,
    comissaoTaxa: 0.08,
    comissaoValor: 6.39,
    emEstoque: true,
  },
];

export class FakeAdapter implements MarketplaceAdapter {
  readonly nome = "fake" as const;
  readonly chamadas: { metodo: string; arg: string }[] = [];
  #produtos = new Map<string, ProdutoMarketplace>();

  constructor() {
    for (const b of BASE) {
      this.#produtos.set(b.idExterno, {
        ...b,
        marketplace: "fake",
        url: `https://fake.example/produto/${b.idExterno}`,
        linkAfiliado: `https://fake.example/af/${b.idExterno}`,
        fotoUrl: `https://fake.example/foto/${b.idExterno}.jpg`,
      });
    }
  }

  /** Força o preço de um produto (para simular uma queda). */
  definirPreco(idExterno: string, preco: number) {
    const p = this.#produtos.get(idExterno);
    if (!p) throw new Error(`produto fake ${idExterno} não existe`);
    this.#produtos.set(idExterno, { ...p, preco });
  }

  remover(idExterno: string) {
    this.#produtos.delete(idExterno);
  }

  async buscar(palavra: string, f: FiltrosBusca = {}): Promise<ProdutoMarketplace[]> {
    this.chamadas.push({ metodo: "buscar", arg: palavra });
    const termos = palavra.toLowerCase().split(/\s+/).filter(Boolean);
    const achados = [...this.#produtos.values()].filter((p) =>
      termos.some((t) => p.nome.toLowerCase().includes(t)),
    );
    const limite = f.limite ?? 50;
    const inicio = ((f.pagina ?? 1) - 1) * limite;
    return filtrarPorPreco(achados, f)
      .slice(inicio, inicio + limite)
      .map((p) => ({ ...p }));
  }

  async detalhe(idExterno: string): Promise<ProdutoMarketplace | null> {
    this.chamadas.push({ metodo: "detalhe", arg: idExterno });
    const p = this.#produtos.get(idExterno);
    return p ? { ...p } : null;
  }

  async gerarLinkAfiliado(url: string, subIds: string[] = []): Promise<string> {
    this.chamadas.push({ metodo: "link", arg: url });
    const id = url.split("/").pop() ?? "x";
    return `https://fake.example/s/${id}${subIds.length ? `?sub=${subIds.join("-")}` : ""}`;
  }
}
