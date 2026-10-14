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

describe("container fora do demo", () => {
  it("sem demo e sem Supabase configurado: sem sessão e dados falham fechado (nunca memória)", async () => {
    const { container } = await import("../src/server/context");
    const c = await container();
    expect(await c.sessions.current()).toBeNull();
    await expect(c.connections.getShopee("demo")).rejects.toMatchObject({ pgMessage: "supabase_not_configured" });
    await expect(c.automations.list("demo")).rejects.toMatchObject({ pgMessage: "supabase_not_configured" });
    await expect(c.sends.list("demo", new Date())).rejects.toBeDefined();
    expect((globalThis as { __achadinhos?: unknown }).__achadinhos).toBeUndefined(); // memória do demo não foi criada
  });

  it("em produção da Vercel o demo nunca liga, mesmo com a flag", async () => {
    process.env.ACHADINHOS_DEMO_SESSION = "1";
    process.env.VERCEL_ENV = "production";
    const { container } = await import("../src/server/context");
    const c = await container();
    expect(await c.sessions.current()).toBeNull();
    await expect(c.connections.listGroups("demo")).rejects.toBeDefined();
  });

  it("modo demo continua em memória (QA visual)", async () => {
    process.env.ACHADINHOS_DEMO_SESSION = "1";
    const { container } = await import("../src/server/context");
    const c = await container();
    expect((await c.sessions.current())?.accountId).toBe("demo");
    expect((await c.connections.listGroups("demo")).length).toBeGreaterThan(0);
  });
});
