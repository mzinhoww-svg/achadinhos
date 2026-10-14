import { describe, expect, it } from "vitest";
import { downloadProductImage } from "../src/image.js";
import { PNG, pngResponse, publicResolve } from "./helpers.js";

const base = { allowedHosts: ["cf.shopee.com.br"], maxBytes: 100, timeoutMs: 1000, resolveHost: publicResolve };
const ok = (async () => pngResponse()) as unknown as typeof fetch;
const redirectTo = (loc: string) =>
  (async () => new Response(null, { status: 302, headers: { location: loc } })) as unknown as typeof fetch;

describe("downloadProductImage (sobre o downloader seguro do creative)", () => {
  it("aceita https na allowlist com magic bytes de png", async () => {
    const r = await downloadProductImage("https://cf.shopee.com.br/a.png", { ...base, fetch: ok });
    expect(r.mime).toBe("image/png");
    expect(r.bytes.length).toBe(PNG.length);
  });
  it.each([
    ["http://cf.shopee.com.br/a.png", "protocolo"],
    ["https://evil.example.com/a.png", "host"],
    ["https://127.0.0.1/a.png", "host"],
    ["https://[::1]/a.png", "host"],
    ["https://cf.shopee.com.br.evil.com/a.png", "host"],
    ["https://user:pw@cf.shopee.com.br/a.png", "protocolo"],
    ["https://cf.shopee.com.br:8443/a.png", "protocolo"],
    ["not a url", "protocolo"],
  ])("rejeita %s", async (url, code) => {
    await expect(downloadProductImage(url, { ...base, fetch: ok })).rejects.toMatchObject({ code });
  });
  it("rejeita corpo acima do limite", async () => {
    const big = (async () =>
      new Response(new Uint8Array(500).fill(0x89), { headers: { "content-type": "image/png" } })) as unknown as typeof fetch;
    await expect(downloadProductImage("https://cf.shopee.com.br/a", { ...base, fetch: big })).rejects.toMatchObject({
      code: "tamanho",
    });
  });
  it("rejeita conteúdo que não é imagem", async () => {
    const html = (async () => new Response("<html>")) as unknown as typeof fetch;
    await expect(downloadProductImage("https://cf.shopee.com.br/a", { ...base, fetch: html })).rejects.toMatchObject({
      code: "tipo",
    });
  });
  it("rejeita tipo declarado diferente do conteúdo (png declarado, jpeg real)", async () => {
    const jpeg = (async () =>
      new Response(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), {
        headers: { "content-type": "image/png" },
      })) as unknown as typeof fetch;
    await expect(downloadProductImage("https://cf.shopee.com.br/a", { ...base, fetch: jpeg })).rejects.toMatchObject({
      code: "tipo",
    });
  });
  it("DNS: host da allowlist que resolve para IP interno => endereco_interno, sem chamar o fetch", async () => {
    let called = false;
    const spy = (async () => ((called = true), pngResponse())) as unknown as typeof fetch;
    for (const ip of ["127.0.0.1", "10.0.0.5", "169.254.169.254", "::1", "::ffff:192.168.0.1", "fd00::1"]) {
      await expect(
        downloadProductImage("https://cf.shopee.com.br/a", { ...base, fetch: spy, resolveHost: async () => [ip] }),
      ).rejects.toMatchObject({ code: "endereco_interno" });
    }
    expect(called).toBe(false);
  });
  it("DNS: qualquer endereço interno entre vários (rebinding misto) bloqueia", async () => {
    await expect(
      downloadProductImage("https://cf.shopee.com.br/a", {
        ...base,
        fetch: ok,
        resolveHost: async () => ["93.184.216.34", "10.0.0.1"],
      }),
    ).rejects.toMatchObject({ code: "endereco_interno" });
  });
  it("DNS: sem resposta, vazio ou falha na resolução => falha fechada (nunca baixa)", async () => {
    let called = false;
    const spy = (async () => ((called = true), pngResponse())) as unknown as typeof fetch;
    await expect(
      downloadProductImage("https://cf.shopee.com.br/a", { ...base, fetch: spy, resolveHost: async () => [] }),
    ).rejects.toMatchObject({ code: "endereco_interno" });
    await expect(
      downloadProductImage("https://cf.shopee.com.br/a", {
        ...base,
        fetch: spy,
        resolveHost: async () => {
          throw new Error("ENOTFOUND secret-internal-name");
        },
      }),
    ).rejects.toMatchObject({ code: "rede" });
    expect(called).toBe(false);
  });
  it("redirect para host fora da allowlist => host", async () => {
    await expect(
      downloadProductImage("https://cf.shopee.com.br/a", { ...base, fetch: redirectTo("https://evil.example/x.png") }),
    ).rejects.toMatchObject({ code: "host" });
  });
  it("redirect para http, para IP literal e para o metadata => bloqueado", async () => {
    for (const loc of ["http://cf.shopee.com.br/x", "https://169.254.169.254/latest", "https://[::1]/x"]) {
      await expect(
        downloadProductImage("https://cf.shopee.com.br/a", { ...base, fetch: redirectTo(loc) }),
      ).rejects.toBeInstanceOf(Error);
    }
  });
  it("redirect para host permitido que resolve para IP interno => endereco_interno", async () => {
    const resolveHost = async (h: string) => (h === "cdn2.shopee.com.br" ? ["10.1.1.1"] : ["93.184.216.34"]);
    await expect(
      downloadProductImage("https://cf.shopee.com.br/a", {
        ...base,
        allowedHosts: ["shopee.com.br"],
        fetch: redirectTo("https://cdn2.shopee.com.br/x.png"),
        resolveHost,
      }),
    ).rejects.toMatchObject({ code: "endereco_interno" });
  });
  it("redirect em laço => redirecionamento (limite de saltos)", async () => {
    await expect(
      downloadProductImage("https://cf.shopee.com.br/a", { ...base, fetch: redirectTo("https://cf.shopee.com.br/a") }),
    ).rejects.toMatchObject({ code: "redirecionamento" });
  });
  it("nunca segue redirect sozinho: o fetch recebe redirect manual", async () => {
    let init: RequestInit | undefined;
    const f = (async (_u: string, i?: RequestInit) => ((init = i), pngResponse())) as unknown as typeof fetch;
    await downloadProductImage("https://cf.shopee.com.br/a", { ...base, fetch: f });
    expect(init?.redirect).toBe("manual");
  });
  it("imagem com dimensões absurdas (bomba de descompressão) => dimensoes", async () => {
    const huge = Uint8Array.from(PNG);
    new DataView(huge.buffer).setUint32(16, 60000);
    new DataView(huge.buffer).setUint32(20, 60000);
    const f = (async () => new Response(huge, { headers: { "content-type": "image/png" } })) as unknown as typeof fetch;
    await expect(downloadProductImage("https://cf.shopee.com.br/a", { ...base, fetch: f })).rejects.toMatchObject({
      code: "dimensoes",
    });
  });
  it("HTTP de erro => http; falha de rede => rede (sem vazar a mensagem)", async () => {
    const e500 = (async () => new Response("x", { status: 500 })) as unknown as typeof fetch;
    await expect(downloadProductImage("https://cf.shopee.com.br/a", { ...base, fetch: e500 })).rejects.toMatchObject({
      code: "http",
    });
    const boom = (async () => {
      throw new Error("connect ECONNREFUSED 10.0.0.9:443 token=abc");
    }) as unknown as typeof fetch;
    const err = await downloadProductImage("https://cf.shopee.com.br/a", { ...base, fetch: boom }).catch((e) => e);
    expect(err.code).toBe("rede");
    expect(String(err.message)).not.toMatch(/10\.0\.0\.9|token/);
  });
});
