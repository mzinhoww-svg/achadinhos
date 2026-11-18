/**
 * Regras de oferta (T2.4) e pontuação (T2.7). Funções puras, sem banco.
 *
 * Oferta real: preço atual pelo menos X% abaixo da mediana dos últimos 30 dias (X por nicho, padrão 15),
 * com avaliação e vendas mínimas. Sem histórico suficiente, não vira oferta.
 */

export interface RegrasOferta {
  descontoMinPct: number;
  avaliacaoMin: number;
  vendasMin: number;
  /** Observações anteriores mínimas na janela de 30 dias. */
  minAmostras: number;
  /** A observação mais antiga precisa ter pelo menos estes dias. */
  minDias: number;
}

export const REGRAS_PADRAO: RegrasOferta = {
  descontoMinPct: 15,
  avaliacaoMin: 4.5,
  vendasMin: 50,
  minAmostras: 4,
  minDias: 3,
};

export interface Observacao {
  preco: number;
  coletadoEm: Date;
}

export interface ProdutoAvaliado {
  preco: number;
  avaliacao: number | null;
  vendas: number | null;
  comissaoTaxa: number | null;
}

export type Avaliacao =
  | { ok: true; mediana: number; descontoPct: number; pontuacao: number }
  | {
      ok: false;
      motivo: "historico_insuficiente" | "desconto_insuficiente" | "avaliacao_baixa" | "vendas_baixas";
      detalhe: string;
      mediana?: number;
      descontoPct?: number;
    };

const DIA_MS = 86_400_000;
const r2 = (n: number) => Math.round(n * 100) / 100;

export function mediana(valores: number[]): number {
  if (valores.length === 0) throw new Error("mediana de lista vazia");
  const v = [...valores].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? (v[m] as number) : ((v[m - 1] as number) + (v[m] as number)) / 2;
}

/**
 * Pontuação de 0 a 100. Pesos: desconto real 45 (cheio aos 50%), comissão 25 (cheia aos 15%),
 * vendas 15 (escala log, cheia aos 10 mil) e nota 15 (de 4,0 a 5,0).
 */
export function pontuar(
  descontoPct: number,
  p: Pick<ProdutoAvaliado, "avaliacao" | "vendas" | "comissaoTaxa">,
): number {
  const desconto = Math.min(Math.max(descontoPct, 0) / 50, 1);
  const comissao = Math.min(Math.max(p.comissaoTaxa ?? 0, 0) / 0.15, 1);
  const vendas = Math.min(Math.log10((p.vendas ?? 0) + 1) / 4, 1);
  const nota = Math.min(Math.max(((p.avaliacao ?? 0) - 4) / 1, 0), 1);
  return r2(100 * (0.45 * desconto + 0.25 * comissao + 0.15 * vendas + 0.15 * nota));
}

/**
 * `historico` são as observações ANTERIORES à atual, nos últimos 30 dias (a atual não entra na mediana,
 * para que a própria queda não puxe a referência para baixo).
 */
export function avaliarOferta(
  p: ProdutoAvaliado,
  historico: Observacao[],
  regras: RegrasOferta,
  agora = new Date(),
): Avaliacao {
  const janela = historico.filter((o) => agora.getTime() - o.coletadoEm.getTime() <= 30 * DIA_MS);
  if (janela.length < regras.minAmostras) {
    return {
      ok: false,
      motivo: "historico_insuficiente",
      detalhe: `${janela.length} de ${regras.minAmostras} observações`,
    };
  }
  const maisAntiga = Math.min(...janela.map((o) => o.coletadoEm.getTime()));
  const dias = (agora.getTime() - maisAntiga) / DIA_MS;
  if (dias < regras.minDias) {
    return {
      ok: false,
      motivo: "historico_insuficiente",
      detalhe: `${r2(dias)} de ${regras.minDias} dias de histórico`,
    };
  }
  const med = mediana(janela.map((o) => o.preco));
  const descontoPct = r2((1 - p.preco / med) * 100);
  if (descontoPct < regras.descontoMinPct) {
    return {
      ok: false,
      motivo: "desconto_insuficiente",
      detalhe: `${descontoPct}% < ${regras.descontoMinPct}%`,
      mediana: med,
      descontoPct,
    };
  }
  if (p.avaliacao === null || p.avaliacao < regras.avaliacaoMin) {
    return {
      ok: false,
      motivo: "avaliacao_baixa",
      detalhe: `${p.avaliacao ?? "sem nota"} < ${regras.avaliacaoMin}`,
      mediana: med,
      descontoPct,
    };
  }
  if (p.vendas === null || p.vendas < regras.vendasMin) {
    return {
      ok: false,
      motivo: "vendas_baixas",
      detalhe: `${p.vendas ?? "sem dado"} < ${regras.vendasMin}`,
      mediana: med,
      descontoPct,
    };
  }
  return { ok: true, mediana: r2(med), descontoPct, pontuacao: pontuar(descontoPct, p) };
}
