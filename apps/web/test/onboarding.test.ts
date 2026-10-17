import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { getOnboarding } from "@/server/onboarding";
import { MemoryAutomations, MemoryConnections } from "@/server/memory";
import type { AutomationDraft } from "@/server/ports";
import { guarded } from "@/server/session";
import { sessionOf, TOKEN_CANARY } from "./helpers";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NF"); }, useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/painel", useSearchParams: () => new URLSearchParams() }));

const A = { accountId: "acc_A", userId: "u" };
const draft: AutomationDraft = { name: "Teste", status: "active", filters: {}, days: [1], windowStart: "08:00", windowEnd: "20:00", frequencyMin: 30, header: null, footer: null, groupIds: [] };

function world() {
  const connections = new MemoryConnections();
  const automations = new MemoryAutomations();
  return { connections, automations, deps: { connections, automations } };
}
const shopee = (accountId: string, status: "pending_validation" | "validated" | "invalid", lastError: string | null = null) =>
  ({ accountId, appId: "123456", secretId: "v1", secretLast4: "0042", status, validatedAt: status === "validated" ? "2026-10-14T10:00:00Z" : null, lastError });
const channel = (accountId: string, status: "pending_validation" | "validated" | "invalid") =>
  ({ accountId, secretId: "v2", botName: "@bot", status, validatedAt: null, lastError: null });
const state = (r: Awaited<ReturnType<typeof getOnboarding>>) => Object.fromEntries(r.steps.map((s) => [s.key, s.state]));

describe("MVP 14 onboarding derivado do estado real", () => {
  it("conta vazia: 4 passos a fazer, próximo = Shopee", async () => {
    const w = world();
    const r = await getOnboarding(w.deps, A);
    expect(r.steps.map((s) => s.key)).toEqual(["shopee", "telegram", "groups", "automation"]);
    expect(state(r)).toEqual({ shopee: "todo", telegram: "todo", groups: "blocked", automation: "todo" });
    expect(r).toMatchObject({ doneCount: 0, total: 4, complete: false, next: "shopee" });
  });
  it("credencial enviada mas não validada = em validação, ainda não concluída", async () => {
    const w = world();
    await w.connections.saveShopee(shopee("acc_A", "pending_validation"));
    const r = await getOnboarding(w.deps, A);
    expect(state(r).shopee).toBe("pending");
    expect(r.next).toBe("shopee");
  });
  it("credencial inválida mostra erro saneado", async () => {
    const w = world();
    await w.connections.saveShopee(shopee("acc_A", "invalid", `401 bot${TOKEN_CANARY} rejeitado`));
    const r = await getOnboarding(w.deps, A);
    expect(state(r).shopee).toBe("error");
    expect(JSON.stringify(r)).not.toContain("CANARY");
    expect(r.steps[0]!.detail).toContain("401");
  });
  it("Shopee validada avança o próximo passo para Telegram", async () => {
    const w = world();
    await w.connections.saveShopee(shopee("acc_A", "validated"));
    const r = await getOnboarding(w.deps, A);
    expect(state(r).shopee).toBe("done");
    expect(r.next).toBe("telegram");
  });
  it("grupos: bloqueado sem bot; todo com bot sem grupo ativo; done com ao menos um ativo", async () => {
    const w = world();
    await w.connections.saveChannel(channel("acc_A", "validated"));
    expect(state(await getOnboarding(w.deps, A)).groups).toBe("todo");
    const [g] = await w.connections.syncGroups("acc_A", [{ chatId: "-1", name: "G", chatType: "supergroup", members: 1 }]);
    expect(state(await getOnboarding(w.deps, A)).groups).toBe("todo");
    await w.connections.setGroupActive("acc_A", g!.id, true);
    const r = await getOnboarding(w.deps, A);
    expect(state(r).groups).toBe("done");
    expect(r.steps.find((s) => s.key === "groups")!.detail).toContain("1");
  });
  it("tudo pronto = complete", async () => {
    const w = world();
    await w.connections.saveShopee(shopee("acc_A", "validated"));
    await w.connections.saveChannel(channel("acc_A", "validated"));
    const [g] = await w.connections.syncGroups("acc_A", [{ chatId: "-1", name: "G", chatType: "group", members: 1 }]);
    await w.connections.setGroupActive("acc_A", g!.id, true);
    await w.automations.createWithinLimit("acc_A", { ...draft, groupIds: [g!.id] }, 5);
    const r = await getOnboarding(w.deps, A);
    expect(r).toMatchObject({ doneCount: 4, complete: true, next: null });
  });
  it("estado de outra conta não conta", async () => {
    const w = world();
    await w.connections.saveShopee(shopee("acc_B", "validated"));
    await w.automations.createWithinLimit("acc_B", draft, 5);
    expect((await getOnboarding(w.deps, A)).doneCount).toBe(0);
  });
  it("passa pela guarda (sem sessão = recusado)", async () => {
    const w = world();
    const r = await guarded(sessionOf(null), (s) => getOnboarding(w.deps, s))({});
    expect(r).toMatchObject({ ok: false, code: "unauthorized" });
  });
});

describe("MVP 14 /painel", () => {
  const sp = (o: Record<string, string> = {}) => Promise.resolve(o);
  beforeAll(() => {
    process.env.ACHADINHOS_DEMO_SESSION = "1";
  });
  it("conta demo: progresso real e dados vindos do repositório", async () => {
    const { default: Page } = await import("@/app/painel/page");
    const out = renderToStaticMarkup((await Page({ searchParams: sp() })) as never);
    expect(out).toContain("Conectar a Shopee");
    expect(out).toContain('aria-valuenow="4"');
    expect(out).toContain("Tudo pronto para postar");
    expect(out).toContain("Enviados hoje");
  });
  it("conta vazia: 0 de 4, links para os passos e estados vazios", async () => {
    const { default: Page } = await import("@/app/painel/page");
    const out = renderToStaticMarkup((await Page({ searchParams: sp({ vazio: "1" }) })) as never);
    expect(out).toContain("0 de 4 passos");
    // R1: sem ACHADINHOS_CONEXOES os passos que apontam para /conexoes viram texto, não link.
    expect(out).not.toContain('href="/conexoes');
    expect(out).toContain("/automacoes/nova");
    expect(out).toContain("Nada na fila agora");
    expect(out).toContain("Tudo certo");
  });
  it("ofertas e envios vazios têm estado vazio com próximo passo", async () => {
    const { default: Ofertas } = await import("@/app/ofertas/page");
    const o = renderToStaticMarkup((await Ofertas({ searchParams: sp({ vazio: "1" }) })) as never);
    expect(o).toContain("Nenhuma oferta ainda");
    expect(o).toContain("Mandar agora");
  });
});
