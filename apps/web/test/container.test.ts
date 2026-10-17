import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const KEYS = ["ACHADINHOS_DEMO_SESSION", "ACHADINHOS_DEMO_LOCAL_BUILD", "SUPABASE_URL", "SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "VERCEL_ENV"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  vi.resetModules();
  (globalThis as { __achadinhos?: unknown }).__achadinhos = undefined;
});
afterEach(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

describe("container do painel (T8-A: só o container em memória)", () => {
  it("monta sem nenhuma variável do Supabase (o caminho Supabase saiu do ativo)", async () => {
    const { container } = await import("../src/server/context");
    const c = await container();
    // memória, não Supabase: os repos respondem de imediato, sem falha de configuração
    expect(typeof c.automations.list).toBe("function");
    expect(typeof c.connections.listGroups).toBe("function");
    // a conta demo é semeada em memória
    expect((await c.connections.listGroups("demo")).length).toBeGreaterThan(0);
  });

  it("sem demo não há sessão (as telas e actions usam guarded → Sessão necessária)", async () => {
    const { container } = await import("../src/server/context");
    const c = await container();
    expect(await c.sessions.current()).toBeNull();
  });

  it("em produção da Vercel o demo nunca liga, mesmo com a flag", async () => {
    process.env.ACHADINHOS_DEMO_SESSION = "1";
    process.env.VERCEL_ENV = "production";
    const { container } = await import("../src/server/context");
    const c = await container();
    expect(await c.sessions.current()).toBeNull();
  });

  it("modo demo: sessão e dados em memória (QA visual)", async () => {
    process.env.ACHADINHOS_DEMO_SESSION = "1";
    const { container } = await import("../src/server/context");
    const c = await container();
    expect((await c.sessions.current())?.accountId).toBe("demo");
    expect((await c.connections.listGroups("demo")).length).toBeGreaterThan(0);
  });

  it("variáveis do Supabase no ambiente não mudam nada: o container é sempre memória", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_ANON_KEY = "public-anon-key";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "public-anon-key";
    const { container } = await import("../src/server/context");
    const c = await container();
    expect(await c.sessions.current()).toBeNull();
    expect((await c.connections.listGroups("demo")).length).toBeGreaterThan(0);
  });
});
