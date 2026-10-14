import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); }, useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/envios", useSearchParams: () => new URLSearchParams() }));

const sp = (o: Record<string, string> = {}) => Promise.resolve(o);
const html = (el: unknown) => renderToStaticMarkup(el as never);

describe("T8-07 tela de Envios", () => {
  beforeAll(() => {
    process.env.ACHADINHOS_DEMO_SESSION = "1";
  });

  it("mostra cards do dia, filtros e a lista com dados", async () => {
    const { default: Page } = await import("@/app/envios/page");
    const out = html(await Page({ searchParams: sp() }));
    for (const t of ["Enviados hoje", "Na fila agora", "Falhas hoje", "Ignorados hoje", "Todos", "Enviados", "Falhas", "Ignorados"]) expect(out).toContain(t);
    expect(out).toContain("Manual");
    expect(out).toContain("Telegram: bot removido do grupo");
    expect(out).toContain('aria-label="Filtrar por grupo"');
  });

  it("filtra por status pela URL e mantém só os da fila", async () => {
    const { default: Page } = await import("@/app/envios/page");
    const out = html(await Page({ searchParams: sp({ status: "failed" }) }));
    expect(out).toContain("bot removido do grupo");
    expect(out).not.toContain("teto diário do canal atingido");
  });

  it("estado vazio ensina o próximo passo", async () => {
    const { default: Page } = await import("@/app/envios/page");
    const out = html(await Page({ searchParams: sp({ vazio: "1" }) }));
    expect(out).toContain("Nenhum envio ainda");
    expect(out).toContain("Criar automação");
    expect(out).toContain("Mandar agora");
  });

  it("filtro sem resultado oferece limpar filtros", async () => {
    const { default: Page } = await import("@/app/envios/page");
    const out = html(await Page({ searchParams: sp({ vazio: "1", status: "failed" }) }));
    expect(out).toContain("Nenhum envio com esse filtro");
    expect(out).toContain("Limpar filtros");
  });

  it("valores hostis na URL não quebram nem entram no HTML", async () => {
    const { default: Page } = await import("@/app/envios/page");
    const out = html(await Page({ searchParams: sp({ status: "<script>alert(1)</script>", grupo: "' or 1=1 --" }) }));
    expect(out).not.toContain("<script>alert(1)</script>");
    expect(out).toContain("Enviados hoje");
  });

  it("action de refresh recusa sem sessão", async () => {
    delete process.env.ACHADINHOS_DEMO_SESSION;
    vi.resetModules();
    const { refreshEnviosAction } = await import("@/app/envios/actions");
    const r = await refreshEnviosAction("all", null);
    expect(r).toMatchObject({ ok: false, code: "unauthorized" });
    process.env.ACHADINHOS_DEMO_SESSION = "1";
  });
});
