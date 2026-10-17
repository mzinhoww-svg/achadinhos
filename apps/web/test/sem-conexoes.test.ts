import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); }, useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/painel", useSearchParams: () => new URLSearchParams() }));

const sp = (o: Record<string, string> = {}) => Promise.resolve(o);
const html = (el: unknown) => renderToStaticMarkup(el as never);

async function allScreens() {
  const { default: Painel } = await import("@/app/painel/page");
  const { default: Nova } = await import("@/app/automacoes/nova/page");
  const { default: Mandar } = await import("@/app/mandar-agora/page");
  return [
    html(await Painel({ searchParams: sp() })),
    html(await Painel({ searchParams: sp({ vazio: "1" }) })),
    html(await Nova({ searchParams: sp() })),
    html(await Nova({ searchParams: sp({ vazio: "1" }) })),
    html(await Mandar({ searchParams: sp() })),
    html(await Mandar({ searchParams: sp({ vazio: "1" }) })),
  ];
}

describe("T8-A/R1 — CTAs para /conexoes atrás da flag", () => {
  beforeAll(() => {
    process.env.ACHADINHOS_DEMO_SESSION = "1";
  });
  afterEach(() => {
    delete process.env.ACHADINHOS_CONEXOES;
  });

  it("sem ACHADINHOS_CONEXOES, nenhuma tela renderiza /conexoes (que responde 404)", async () => {
    delete process.env.ACHADINHOS_CONEXOES;
    for (const out of await allScreens()) expect(out).not.toContain("href=\"/conexoes");
  });

  it("com ACHADINHOS_CONEXOES=1, os CTAs voltam a apontar para /conexoes", async () => {
    process.env.ACHADINHOS_CONEXOES = "1";
    // conta vazia: sem grupos ativos, o CTA "Ir para Conexões" reaparece
    const { default: Nova } = await import("@/app/automacoes/nova/page");
    expect(html(await Nova({ searchParams: sp({ vazio: "1" }) }))).toContain('href="/conexoes"');
    // /painel volta a linkar os passos do checklist
    const { default: Painel } = await import("@/app/painel/page");
    expect(html(await Painel({ searchParams: sp({ vazio: "1" }) }))).toContain('href="/conexoes');
  });
});
