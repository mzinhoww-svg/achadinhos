import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); }, useRouter: () => ({ push: vi.fn() }) }));

const SECRET = "SHOPEE-SECRET-CANARY-9f3a7c1d5e";
const TOKEN = "7123456789:AAH-CANARY-token_b0t_9f3a7c1d5e2b4a6c";
const SEEDED = ["demo-secret-nao-real-0042", "1000000001:DEMO-token-nao-real-000000000000"];

const sp = (o: Record<string, string> = {}) => Promise.resolve(o);
const html = (el: unknown) => renderToStaticMarkup(el as never);
/** O que o RSC serializaria para o cliente: props de elementos (funções somem no JSON). */
const flight = (el: unknown) => {
  const seen = new WeakSet<object>();
  return JSON.stringify(el, (k, v) => {
    if (k.startsWith("_debug") || k === "_owner" || k === "_store") return undefined;
    if (v && typeof v === "object") {
      if (seen.has(v)) return undefined;
      seen.add(v);
    }
    return typeof v === "bigint" ? String(v) : v;
  });
};

async function allPages() {
  const { default: Conexoes } = await import("@/app/conexoes/page");
  const { default: Automacoes } = await import("@/app/automacoes/page");
  const { default: Nova } = await import("@/app/automacoes/nova/page");
  const { default: Detalhe } = await import("@/app/automacoes/[id]/page");
  const { default: Editar } = await import("@/app/automacoes/[id]/editar/page");
  const { container } = await import("@/server/context");
  const c = await container();
  const id = (await c.automations.list("demo"))[0]!.id;
  const idParams = Promise.resolve({ id });
  return [
    await Conexoes({ searchParams: sp() }),
    await Conexoes({ searchParams: sp({ vazio: "1" }) }),
    await Automacoes({ searchParams: sp() }),
    await Nova({ searchParams: sp() }),
    await Detalhe({ params: idParams, searchParams: sp() }),
    await Editar({ params: idParams, searchParams: sp() }),
  ];
}

describe("T8-02/03 segredo nunca sai (rotas autenticadas)", () => {
  beforeAll(() => {
    process.env.ACHADINHOS_DEMO_SESSION = "1";
    // /conexoes é tela dormente (T8-A): a rota existe, mas só rende com a flag ligada.
    process.env.ACHADINHOS_CONEXOES = "1";
  });

  it("salva Secret e token por action e nenhuma tela/payload contém os valores", async () => {
    const { saveShopeeAction, saveTelegramAction } = await import("@/app/conexoes/actions");
    const f1 = new FormData();
    f1.set("appId", "18350000042");
    f1.set("secret", SECRET);
    const r1 = await saveShopeeAction(null, f1);
    expect(r1).toMatchObject({ ok: true });
    const f2 = new FormData();
    f2.set("token", TOKEN);
    const r2 = await saveTelegramAction(null, f2);
    expect(r2).toMatchObject({ ok: true });
    for (const r of [r1, r2]) expect(JSON.stringify(r)).not.toMatch(/CANARY/);

    for (const page of await allPages()) {
      const markup = html(page);
      const payload = flight(page);
      for (const needle of [SECRET, TOKEN, ...SEEDED, "CANARY"]) {
        expect(markup).not.toContain(needle);
        expect(payload).not.toContain(needle);
      }
    }
  });

  it("mostra só os 4 últimos do Secret", async () => {
    const { default: Conexoes } = await import("@/app/conexoes/page");
    expect(html(await Conexoes({ searchParams: sp() }))).toContain(`termina em ${SECRET.slice(-4)}`);
  });

  it("action com account_id forjado é recusada", async () => {
    const { saveAutomationAction } = await import("@/app/automacoes/actions");
    const fd = new FormData();
    fd.set("name", "x");
    fd.set("account_id", "outra-conta");
    expect(await saveAutomationAction(null, fd)).toMatchObject({ ok: false, code: "forbidden" });
    const { saveShopeeAction } = await import("@/app/conexoes/actions");
    const f = new FormData();
    f.set("account_id", "outra-conta");
    f.set("appId", "18350000042");
    f.set("secret", SECRET);
    expect(await saveShopeeAction(null, f)).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("?vazio=1 em /automacoes/nova mostra estado vazio com link para Conexões", async () => {
    const { default: Nova } = await import("@/app/automacoes/nova/page");
    const out = html(await Nova({ searchParams: sp({ vazio: "1" }) }));
    expect(out).toContain("Nenhum grupo ativo");
    expect(out).toContain('href="/conexoes"');
    expect(out).not.toContain("Onde postar");
  });

  it("sem sessão: toda action recusa e as telas pedem sessão", async () => {
    process.env.ACHADINHOS_DEMO_SESSION = "0";
    const { saveShopeeAction, saveTelegramAction, setGroupActiveAction } = await import("@/app/conexoes/actions");
    const { saveAutomationAction, deleteAutomationAction } = await import("@/app/automacoes/actions");
    const fd = new FormData();
    fd.set("appId", "18350000042");
    fd.set("secret", SECRET);
    expect(await saveShopeeAction(null, fd)).toMatchObject({ ok: false, code: "unauthorized" });
    expect(await saveTelegramAction(null, fd)).toMatchObject({ ok: false, code: "unauthorized" });
    expect(await setGroupActiveAction("g", true)).toMatchObject({ ok: false });
    expect(await saveAutomationAction(null, fd)).toMatchObject({ ok: false, code: "unauthorized" });
    expect(await deleteAutomationAction("x")).toMatchObject({ ok: false });
    const { default: Conexoes } = await import("@/app/conexoes/page");
    expect(html(await Conexoes({ searchParams: sp() }))).toContain("Sessão necessária");
  });
});
