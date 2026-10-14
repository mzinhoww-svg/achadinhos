import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

const fieldErrors = {
  name: "Dê um nome para reconhecer a automação.",
  maxPrice: "Preço máximo: informe um valor maior que zero.",
  minDiscount: "Desconto mínimo: use um valor entre 0 e 100.",
  minCommission: "Comissão mínima: informe um número válido.",
  minRating: "Avaliação mínima: use um valor entre 0 e 5.",
  minSales: "Vendas mínimas: use um número inteiro.",
  header: "Cabeçalho: use no máximo 80 caracteres.",
  footer: "Rodapé: use no máximo 200 caracteres.",
  frequencyMin: "Escolha 15, 30 ou 60 minutos.",
  windowStart: "Horário inválido",
  windowEnd: "Horário inválido (fim)",
  days: "Selecione ao menos um dia",
  groupIds: "Escolha só grupos ativos da sua conta.",
  chaveDesconhecida: "Erro de uma chave que a tela não conhece.",
};

vi.mock("react", async (orig) => ({
  ...(await orig<typeof import("react")>()),
  useActionState: () => [{ ok: false, code: "invalid", message: "Confira os campos.", fieldErrors }, vi.fn(), false],
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/app/automacoes/actions", () => ({ saveAutomationAction: vi.fn() }));

describe("formulário de automação: nenhum erro some", () => {
  it("toda chave de fieldErrors aparece no DOM, em região aria-live", async () => {
    const { AutomationForm } = await import("@/components/automation-form");
    const html = renderToStaticMarkup(
      createElement(AutomationForm, { groups: [{ id: "g", name: "G" }], automationsUsed: 1, maxAutomations: 5, dailyCap: 200 }),
    );
    for (const [k, msg] of Object.entries(fieldErrors)) expect(html, `chave ${k}`).toContain(msg);
    expect(html).toMatch(/aria-live="(assertive|polite)"/);
    expect(html).toMatch(/aria-invalid="true"/);
    // resumo no topo lista todas as mensagens, inclusive a de chave desconhecida
    const summary = html.slice(html.indexOf('data-error-summary'));
    expect(summary).toContain(fieldErrors.chaveDesconhecida);
  });
});
