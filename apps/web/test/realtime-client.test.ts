import { describe, expect, it, vi } from "vitest";
import { createRealtimeClient, getRealtimeClient, readRealtimeConfig } from "@/lib/realtime-client";
import { shouldPoll } from "@/lib/realtime";

const jwt = (role: string) => `h.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.s`;
const ANON = jwt("anon");
const env = { NEXT_PUBLIC_SUPABASE_URL: "https://proj.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON };

describe("T8-11 configuração por env", () => {
  it("lê URL e anon key", () => {
    expect(readRealtimeConfig(env)).toEqual({ url: "https://proj.supabase.co", anonKey: ANON });
  });
  it("sem URL ou sem chave → null (cai no polling)", () => {
    expect(readRealtimeConfig({})).toBeNull();
    expect(readRealtimeConfig({ NEXT_PUBLIC_SUPABASE_URL: env.NEXT_PUBLIC_SUPABASE_URL })).toBeNull();
    expect(readRealtimeConfig({ NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON })).toBeNull();
  });
  it("recusa chave service_role no navegador", () => {
    expect(readRealtimeConfig({ ...env, NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt("service_role") })).toBeNull();
  });
  it("recusa URL que não é https (exceto localhost)", () => {
    expect(readRealtimeConfig({ ...env, NEXT_PUBLIC_SUPABASE_URL: "http://evil.example" })).toBeNull();
    expect(readRealtimeConfig({ ...env, NEXT_PUBLIC_SUPABASE_URL: "javascript:alert(1)" })).toBeNull();
    expect(readRealtimeConfig({ ...env, NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" })).not.toBeNull();
  });
});

describe("T8-11 cliente real", () => {
  it("sem token do usuário não cria cliente (anon não passa no RLS)", () => {
    const create = vi.fn();
    expect(getRealtimeClient({ env, accessToken: null, create })).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });
  it("sem env não cria cliente mesmo com token", () => {
    const create = vi.fn();
    expect(getRealtimeClient({ env: {}, accessToken: "tok", create })).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });
  it("com env e token: usa a anon key e autentica o realtime com o JWT do usuário", () => {
    const setAuth = vi.fn();
    const sb = { channel: vi.fn(), removeChannel: vi.fn(), realtime: { setAuth } };
    const create = vi.fn(() => sb);
    const c = getRealtimeClient({ env, accessToken: "user-jwt", create });
    expect(create).toHaveBeenCalledWith("https://proj.supabase.co", ANON, expect.objectContaining({ auth: expect.objectContaining({ persistSession: false }) }));
    expect(setAuth).toHaveBeenCalledWith("user-jwt");
    expect(c).not.toBeNull();
  });
  it("falha ao criar o cliente → null (polling), nunca lança", () => {
    const create = vi.fn(() => { throw new Error("boom"); });
    expect(getRealtimeClient({ env, accessToken: "t", create })).toBeNull();
  });
  it("createRealtimeClient usa o SDK de verdade sem abrir conexão", () => {
    const c = createRealtimeClient({ url: "https://proj.supabase.co", anonKey: ANON }, "user-jwt");
    expect(typeof c.channel).toBe("function");
    expect(typeof c.removeChannel).toBe("function");
  });
});

describe("T8-11 fallback de polling", () => {
  it("só dispensa o polling quando a assinatura está ao vivo", () => {
    expect(shouldPoll("live")).toBe(false);
    expect(shouldPoll("reconnecting")).toBe(true);
    expect(shouldPoll("polling")).toBe(true);
  });
});
