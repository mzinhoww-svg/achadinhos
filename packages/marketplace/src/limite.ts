import { ErroMarketplace, type MarketplaceAdapter } from "./tipos.ts";

/**
 * Limite de taxa (balde de fichas) e nova tentativa com espera crescente, por adaptador.
 * Só erros recuperáveis (rede, tempo, 5xx, limite de taxa) são repetidos; os outros sobem na hora.
 * Cada falha é avisada em `aoErro`, que o worker grava como evento.
 */

export interface FalhaMarketplace {
  marketplace: string;
  metodo: "buscar" | "detalhe" | "gerarLinkAfiliado";
  tentativa: number;
  codigo: string;
  mensagem: string;
  vaiTentarDeNovo: boolean;
  esperaMs: number;
  /** Palavra-chave ou id do produto, para achar padrões nas falhas. */
  alvo?: string;
}

export interface OpcoesLimite {
  /** Chamadas por minuto (o balde enche continuamente). */
  porMinuto: number;
  /** Tentativas no total, contando a primeira. */
  tentativas?: number;
  esperaBaseMs?: number;
  esperaMaxMs?: number;
  aoErro?: (f: FalhaMarketplace) => void | Promise<void>;
  dormir?: (ms: number) => Promise<void>;
  agora?: () => number;
  aleatorio?: () => number;
}

export function comLimite<A extends MarketplaceAdapter>(adapter: A, o: OpcoesLimite): A {
  const dormir = o.dormir ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const agora = o.agora ?? Date.now;
  const aleatorio = o.aleatorio ?? Math.random;
  const tentativas = Math.max(1, o.tentativas ?? 3);
  const base = o.esperaBaseMs ?? 1000;
  const teto = o.esperaMaxMs ?? 30_000;
  const capacidade = Math.max(1, o.porMinuto);
  const porMs = capacidade / 60_000;
  let fichas = capacidade;
  let ultima = agora();
  // As chamadas entram em fila para respeitar o limite mesmo quando chegam juntas.
  let fila: Promise<void> = Promise.resolve();

  function pegarFicha(): Promise<void> {
    const vez = fila.then(async () => {
      for (;;) {
        const t = agora();
        fichas = Math.min(capacidade, fichas + (t - ultima) * porMs);
        ultima = t;
        if (fichas >= 1) {
          fichas -= 1;
          return;
        }
        await dormir(Math.ceil((1 - fichas) / porMs));
      }
    });
    fila = vez.catch(() => {});
    return vez;
  }

  async function executar<T>(
    metodo: FalhaMarketplace["metodo"],
    chamada: () => Promise<T>,
    alvo?: string,
  ): Promise<T> {
    for (let n = 1; ; n++) {
      await pegarFicha();
      try {
        return await chamada();
      } catch (e) {
        const erro =
          e instanceof ErroMarketplace
            ? e
            : new ErroMarketplace(e instanceof Error ? e.message : String(e), "DESCONHECIDO", false);
        const repetir = erro.recuperavel && n < tentativas;
        // Limite de taxa espera mais; erro do sistema da Shopee também (ela se recupera em segundos).
        // O jitter evita que várias chamadas voltem juntas.
        const fator =
          erro.codigo === "LIMITE_TAXA" || erro.status === 429 ? 5 : erro.codigo === "ERRO_SISTEMA" ? 3 : 1;
        const espera = repetir ? Math.min(teto, base * fator * 2 ** (n - 1) * (0.75 + aleatorio() * 0.5)) : 0;
        await o.aoErro?.({
          marketplace: adapter.nome,
          metodo,
          tentativa: n,
          codigo: erro.codigo,
          mensagem: erro.message,
          vaiTentarDeNovo: repetir,
          esperaMs: Math.round(espera),
          ...(alvo ? { alvo: alvo.slice(0, 80) } : {}),
        });
        if (!repetir) throw erro;
        await dormir(espera);
      }
    }
  }

  const envolvido = Object.create(adapter) as A;
  envolvido.buscar = (palavra, filtros) =>
    executar("buscar", () => adapter.buscar(palavra, filtros), palavra);
  envolvido.detalhe = ((id: string, ...resto: unknown[]) =>
    executar(
      "detalhe",
      () => (adapter.detalhe as (id: string, ...r: unknown[]) => ReturnType<A["detalhe"]>)(id, ...resto),
      id,
    )) as A["detalhe"];
  envolvido.gerarLinkAfiliado = (url, subIds) =>
    executar("gerarLinkAfiliado", () => adapter.gerarLinkAfiliado(url, subIds));
  if (adapter.conversoes) {
    const original = adapter.conversoes.bind(adapter);
    envolvido.conversoes = (desde, ate) => executar("buscar", () => original(desde, ate), "conversionReport");
  }
  return envolvido;
}
