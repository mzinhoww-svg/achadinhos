import { describe, expect, it } from "vitest";
import { createDbClock } from "../src/sql/clock.js";
import { SupabaseCreativeStore, CreativeStoreConfigError } from "../src/sql/creative-store.js";
import { Secret } from "../src/config.js";

describe("createDbClock", () => {
  it("segue o relógio do banco (offset), não o do processo", async () => {
    let local = 1_000_000;
    const db = { query: async () => ({ rows: [{ t: new Date(local + 3_600_000) }] as never[] }) };
    const c = createDbClock(db, () => local);
    expect(c.now().getTime()).toBe(1_000_000); // antes do sync: sem offset
    await c.sync();
    expect(c.now().getTime()).toBe(1_000_000 + 3_600_000);
    local += 5_000;
    expect(c.now().getTime()).toBe(1_005_000 + 3_600_000);
  });
});

describe("SupabaseCreativeStore (bucket privado, URL assinada)", () => {
  const key = new Secret("service-role-NAO-REAL");
  const make = (fetchImpl: typeof fetch) =>
    new SupabaseCreativeStore({ url: "https://proj.supabase.co", serviceRoleKey: key, bucket: "creatives", fetch: fetchImpl, timeoutMs: 1_000, signedTtlSec: 300 });

  it("sobe o PNG e devolve URL assinada + caminho do objeto (nunca a URL no creative_url)", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const f = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return url.includes("/object/sign/")
        ? new Response(JSON.stringify({ signedURL: "/object/sign/creatives/s1.png?token=abc" }), { status: 200 })
        : new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const r = await make(f).put(new Uint8Array([1, 2, 3]), "s1");
    expect(r.objectPath).toBe("s1.png");
    expect(r.photoUrl).toBe("https://proj.supabase.co/storage/v1/object/sign/creatives/s1.png?token=abc");
    expect(calls[0]!.url).toBe("https://proj.supabase.co/storage/v1/object/creatives/s1.png");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer service-role-NAO-REAL");
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("erro do storage não vaza a chave nem o corpo", async () => {
    const f = (async () => new Response("service-role-NAO-REAL detalhe", { status: 500 })) as unknown as typeof fetch;
    const err = await make(f).put(new Uint8Array([1]), "s2").catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect(String((err as Error).message)).not.toContain("service-role-NAO-REAL");
    expect(String((err as Error).message)).not.toContain("detalhe");
  });

  it("recusa configuração insegura (http, sem chave)", () => {
    expect(() => new SupabaseCreativeStore({ url: "http://proj.supabase.co", serviceRoleKey: key, bucket: "c" })).toThrow(CreativeStoreConfigError);
    expect(() => new SupabaseCreativeStore({ url: "https://p.supabase.co", serviceRoleKey: new Secret(""), bucket: "c" })).toThrow(CreativeStoreConfigError);
  });

  it("sendId com caractere de caminho é recusado", async () => {
    await expect(make((async () => new Response("{}")) as unknown as typeof fetch).put(new Uint8Array([1]), "../x")).rejects.toThrow();
  });
});
