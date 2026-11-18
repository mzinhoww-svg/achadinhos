import { describe, expect, it } from "vitest";
import { avaliarOferta, mediana, pontuar, REGRAS_PADRAO } from "./regras.js";

const agora = new Date("2026-11-18T12:00:00Z");
const dias = (d: number) => new Date(agora.getTime() - d * 86_400_000);
const hist = (precos: number[], espacoDias = 1) =>
  precos.map((preco, i) => ({ preco, coletadoEm: dias((i + 1) * espacoDias) }));
const bom = { avaliacao: 4.8, vendas: 2000, comissaoTaxa: 0.08 };

describe("regras de oferta", () => {
  it("mediana de lista par e ímpar", () => {
    expect(mediana([3, 1, 2])).toBe(2);
    expect(mediana([4, 1, 3, 2])).toBe(2.5);
  });

  it("sem histórico suficiente não vira oferta (amostras ou dias)", () => {
    expect(avaliarOferta({ preco: 10, ...bom }, hist([20, 20]), REGRAS_PADRAO, agora)).toMatchObject({
      ok: false,
      motivo: "historico_insuficiente",
    });
    // 6 amostras, mas todas nas últimas 12 horas.
    const recente = [1, 2, 3, 4, 5, 6].map((h) => ({
      preco: 20,
      coletadoEm: new Date(agora.getTime() - h * 3_600_000),
    }));
    expect(avaliarOferta({ preco: 10, ...bom }, recente, REGRAS_PADRAO, agora)).toMatchObject({
      ok: false,
      motivo: "historico_insuficiente",
    });
    // Observações com mais de 30 dias não contam.
    expect(
      avaliarOferta({ preco: 10, ...bom }, hist([20, 20, 20, 20, 20], 10), REGRAS_PADRAO, agora),
    ).toMatchObject({ ok: false, motivo: "historico_insuficiente" });
  });

  it("exige X% abaixo da mediana de 30 dias (X do nicho)", () => {
    const h = hist([50, 50, 52, 48, 50]);
    expect(avaliarOferta({ preco: 44, ...bom }, h, REGRAS_PADRAO, agora)).toMatchObject({
      ok: false,
      motivo: "desconto_insuficiente",
      descontoPct: 12,
    });
    const ok = avaliarOferta({ preco: 40, ...bom }, h, REGRAS_PADRAO, agora);
    expect(ok).toMatchObject({ ok: true, mediana: 50, descontoPct: 20 });
    expect(avaliarOferta({ preco: 44, ...bom }, h, { ...REGRAS_PADRAO, descontoMinPct: 10 }, agora).ok).toBe(
      true,
    );
  });

  it("aplica avaliação e vendas mínimas", () => {
    const h = hist([50, 50, 50, 50]);
    expect(avaliarOferta({ preco: 30, ...bom, avaliacao: 4.2 }, h, REGRAS_PADRAO, agora)).toMatchObject({
      motivo: "avaliacao_baixa",
    });
    expect(avaliarOferta({ preco: 30, ...bom, vendas: 10 }, h, REGRAS_PADRAO, agora)).toMatchObject({
      motivo: "vendas_baixas",
    });
    expect(avaliarOferta({ preco: 30, ...bom, avaliacao: null }, h, REGRAS_PADRAO, agora)).toMatchObject({
      motivo: "avaliacao_baixa",
    });
  });

  it("pontuação cresce com desconto, comissão, vendas e nota", () => {
    const base = pontuar(20, bom);
    expect(pontuar(40, bom)).toBeGreaterThan(base);
    expect(pontuar(20, { ...bom, comissaoTaxa: 0.12 })).toBeGreaterThan(base);
    expect(pontuar(20, { ...bom, vendas: 9000 })).toBeGreaterThan(base);
    expect(pontuar(20, { ...bom, avaliacao: 5 })).toBeGreaterThan(base);
    expect(pontuar(100, { avaliacao: 5, vendas: 1e6, comissaoTaxa: 1 })).toBe(100);
  });
});
