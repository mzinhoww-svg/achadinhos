import { describe, expect, it, vi } from "vitest";
import { createElement, isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PrototypeForm } from "@/components/prototype-form";
import ConexoesPage from "@/app/conexoes/page";
import NovaAutomacaoPage from "@/app/automacoes/nova/page";

function findForms(node: unknown, out: ReactElement<Record<string, unknown>>[] = []) {
  if (Array.isArray(node)) node.forEach((n) => findForms(n, out));
  else if (isValidElement(node)) {
    const el = node as ReactElement<Record<string, unknown>>;
    if (el.type === PrototypeForm) out.push(el);
    findForms(el.props.children, out);
  }
  return out;
}

describe("segredo nunca em rota", () => {
  it("PrototypeForm usa POST e cancela o envio implícito (Enter não navega com ?bot_token=)", () => {
    const form = PrototypeForm({ "aria-label": "x", children: null }) as ReactElement<Record<string, unknown>>;
    expect(form.type).toBe("form");
    expect(form.props.method).toBe("post");
    const preventDefault = vi.fn();
    (form.props.onSubmit as (e: unknown) => void)({ preventDefault });
    expect(preventDefault).toHaveBeenCalled();
  });

  it("os dois formulários de /conexoes (Shopee e Telegram) usam PrototypeForm", async () => {
    const tree = await ConexoesPage({ searchParams: Promise.resolve({}) });
    const forms = findForms(tree).map((f) => f.props["aria-label"]);
    expect(forms).toEqual(["Credenciais da Shopee", "Token do bot do Telegram"]);
    // nenhum <form> cru restante com campo de segredo
    expect(renderToStaticMarkup(createElement("div", null, tree as never))).not.toMatch(/<form(?![^>]*method="post")/);
  });
});

describe("/automacoes/nova — estado vazio", () => {
  it("?vazio=1 mostra estado vazio com link para Conexões e não o formulário", async () => {
    const html = renderToStaticMarkup((await NovaAutomacaoPage({ searchParams: Promise.resolve({ vazio: "1" }) })) as never);
    expect(html).toContain("Nenhum grupo ativo");
    expect(html).toContain('href="/conexoes"');
    expect(html).not.toContain("Onde postar");
  });
  it("com grupos ativos mostra o formulário", async () => {
    const html = renderToStaticMarkup((await NovaAutomacaoPage({ searchParams: Promise.resolve({}) })) as never);
    expect(html).toContain("Onde postar");
  });
});
