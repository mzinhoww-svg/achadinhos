import { afterEach, describe, expect, it, vi } from "vitest";

describe("Farol R1 — sessão demo nunca em produção", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    delete (globalThis as { __achadinhos?: unknown }).__achadinhos;
  });
  async function session() {
    const { container } = await import("@/server/context");
    return (await container()).sessions.current();
  }
  it("flag sozinha em NODE_ENV=production não dá sessão", async () => {
    vi.stubEnv("ACHADINHOS_DEMO_SESSION", "1");
    vi.stubEnv("NODE_ENV", "production");
    expect(await session()).toBeNull();
  });
  it("VERCEL_ENV=production nunca dá sessão, mesmo com a liberação local", async () => {
    vi.stubEnv("ACHADINHOS_DEMO_SESSION", "1");
    vi.stubEnv("ACHADINHOS_DEMO_LOCAL_BUILD", "1");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "production");
    expect(await session()).toBeNull();
  });
  it("em desenvolvimento a flag funciona", async () => {
    vi.stubEnv("ACHADINHOS_DEMO_SESSION", "1");
    vi.stubEnv("NODE_ENV", "development");
    expect(await session()).toMatchObject({ accountId: "demo" });
  });
  it("build local de produção só com a segunda variável explícita", async () => {
    vi.stubEnv("ACHADINHOS_DEMO_SESSION", "1");
    vi.stubEnv("ACHADINHOS_DEMO_LOCAL_BUILD", "1");
    vi.stubEnv("NODE_ENV", "production");
    expect(await session()).toMatchObject({ accountId: "demo" });
  });
});
