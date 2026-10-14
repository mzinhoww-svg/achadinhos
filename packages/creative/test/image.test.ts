import { describe, expect, it, vi } from "vitest";
import { CreativeError, fetchProductImage, imageInfo, isBlockedAddress } from "../src/image.ts";
import { bodyStream, productPng } from "./helpers.ts";

const png = productPng();
const OK_URL = "https://down-br.img.susercontent.com/file/abc";
const resolveOk = async () => ["104.18.10.20"];

function res(body: Uint8Array | ReadableStream<Uint8Array>, headers: Record<string, string> = { "content-type": "image/png" }, status = 200) {
  return new Response(body as never, { status, headers });
}
const opts = (fetch: (u: string, i?: unknown) => Promise<Response>, extra = {}) => ({ fetch: fetch as never, resolveHost: resolveOk, ...extra });

describe("fetchProductImage — falha fechada", () => {
  it("baixa png válido da allowlist e devolve bytes + tipo + dimensões", async () => {
    const out = await fetchProductImage(OK_URL, opts(async () => res(png)));
    expect(out.mime).toBe("image/png");
    expect(out.width).toBe(800);
    expect(out.bytes.length).toBe(png.length);
  });
  it.each([
    ["http (sem TLS)", "http://down-br.img.susercontent.com/a", "scheme"],
    ["host fora da allowlist", "https://evil.example/a.png", "host_not_allowed"],
    ["host parecido com sufixo", "https://susercontent.com.evil.example/a.png", "host_not_allowed"],
    ["credenciais na URL", "https://u:p@down-br.img.susercontent.com/a", "scheme"],
    ["porta estranha", "https://down-br.img.susercontent.com:8443/a", "scheme"],
    ["data URI", "data:image/png;base64,AAAA", "scheme"],
    ["URL inválida", "não é url", "scheme"],
  ])("recusa %s", async (_n, url, code) => {
    const f = vi.fn();
    await expect(fetchProductImage(url, opts(f))).rejects.toMatchObject({ code });
    expect(f).not.toHaveBeenCalled();
  });
  it.each([["127.0.0.1"], ["10.0.0.5"], ["192.168.1.9"], ["169.254.169.254"], ["::1"], ["fd00::1"], ["::ffff:10.0.0.1"]])(
    "bloqueia DNS que resolve para endereço interno (%s)",
    async (ip) => {
      const f = vi.fn();
      await expect(fetchProductImage(OK_URL, { fetch: f as never, resolveHost: async () => [ip] })).rejects.toMatchObject({ code: "blocked_address" });
      expect(f).not.toHaveBeenCalled();
    },
  );
  it("um endereço interno entre vários resolvidos já bloqueia", async () => {
    await expect(fetchProductImage(OK_URL, { fetch: vi.fn() as never, resolveHost: async () => ["104.18.10.20", "10.0.0.1"] })).rejects.toMatchObject({ code: "blocked_address" });
  });
  it("redirect para fora da allowlist é recusado; dentro, seguido (máx. 3)", async () => {
    const out = await fetchProductImage(OK_URL, opts(async (u) => (u === OK_URL ? new Response(null, { status: 302, headers: { location: "https://cf.shopee.com.br/x" } }) : res(png))));
    expect(out.mime).toBe("image/png");
    await expect(
      fetchProductImage(OK_URL, opts(async () => new Response(null, { status: 302, headers: { location: "https://evil.example/x" } }))),
    ).rejects.toMatchObject({ code: "host_not_allowed" });
    await expect(
      fetchProductImage(OK_URL, opts(async () => new Response(null, { status: 302, headers: { location: OK_URL } }))),
    ).rejects.toMatchObject({ code: "too_many_redirects" });
  });
  it("redireciona para endereço interno via DNS é bloqueado", async () => {
    const resolveHost = vi.fn().mockResolvedValueOnce(["104.18.10.20"]).mockResolvedValueOnce(["10.0.0.1"]);
    await expect(
      fetchProductImage(OK_URL, { resolveHost, fetch: (async () => new Response(null, { status: 302, headers: { location: "https://cf.shopee.com.br/x" } })) as never }),
    ).rejects.toMatchObject({ code: "blocked_address" });
  });
  it("status != 200 falha", async () => {
    await expect(fetchProductImage(OK_URL, opts(async () => res(png, {}, 404)))).rejects.toMatchObject({ code: "http_status" });
  });
  it("corpo acima do limite aborta durante a leitura, mesmo sem content-length", async () => {
    const big = new Uint8Array(64 * 1024).fill(1);
    const chunks = Array.from({ length: 200 }, () => big);
    await expect(fetchProductImage(OK_URL, opts(async () => res(bodyStream(chunks)), { maxBytes: 1024 * 1024 }))).rejects.toMatchObject({ code: "too_large" });
  });
  it("content-length acima do limite recusa antes de ler", async () => {
    await expect(
      fetchProductImage(OK_URL, opts(async () => res(png, { "content-type": "image/png", "content-length": String(50 * 1024 * 1024) }))),
    ).rejects.toMatchObject({ code: "too_large" });
  });
  it("timeout total cobre a leitura do corpo estancado", async () => {
    const t0 = Date.now();
    await expect(
      fetchProductImage(OK_URL, opts(async () => res(bodyStream([png.subarray(0, 100)], { stallAfter: true })), { timeoutMs: 150 })),
    ).rejects.toMatchObject({ code: "timeout" });
    expect(Date.now() - t0).toBeLessThan(2000);
  });
  it("content-type não imagem é recusado", async () => {
    await expect(fetchProductImage(OK_URL, opts(async () => res(png, { "content-type": "text/html" })))).rejects.toMatchObject({ code: "bad_type" });
    await expect(fetchProductImage(OK_URL, opts(async () => res(png, { "content-type": "image/svg+xml" })))).rejects.toMatchObject({ code: "bad_type" });
  });
  it("magic bytes mandam: HTML com content-type image/png é recusado", async () => {
    const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");
    await expect(fetchProductImage(OK_URL, opts(async () => res(html)))).rejects.toMatchObject({ code: "bad_type" });
  });
  it("bomba de descompressão: dimensões acima do limite são recusadas antes de decodificar", async () => {
    const bomb = Buffer.from(png);
    bomb.writeUInt32BE(20000, 16);
    bomb.writeUInt32BE(20000, 20);
    await expect(fetchProductImage(OK_URL, opts(async () => res(bomb)))).rejects.toMatchObject({ code: "too_many_pixels" });
  });
  it("erro de rede vira CreativeError sem vazar a URL", async () => {
    const err = await fetchProductImage(`${OK_URL}?token=SEGREDO`, opts(async () => { throw new Error("ECONNRESET https://x/?token=SEGREDO"); })).catch((e) => e);
    expect(err).toBeInstanceOf(CreativeError);
    expect(err.code).toBe("network");
    expect(String(err.message)).not.toContain("SEGREDO");
  });
});

describe("imageInfo / isBlockedAddress", () => {
  it("reconhece png, jpeg e webp pelos magic bytes", () => {
    expect(imageInfo(png)).toMatchObject({ mime: "image/png", width: 800, height: 800 });
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0x01, 0x2c, 0x02, 0x58, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
    expect(imageInfo(jpeg)).toMatchObject({ mime: "image/jpeg", width: 600, height: 300 });
    const webp = new Uint8Array(30);
    webp.set(new TextEncoder().encode("RIFF"), 0);
    webp.set(new TextEncoder().encode("WEBPVP8X"), 8);
    webp[24] = 0x57; webp[25] = 0x02; webp[26] = 0; // largura-1 = 599
    webp[27] = 0x2b; webp[28] = 0x01; webp[29] = 0; // altura-1 = 299
    expect(imageInfo(webp)).toMatchObject({ mime: "image/webp", width: 600, height: 300 });
    expect(imageInfo(new Uint8Array([1, 2, 3]))).toBeNull();
  });
  it("classifica endereços", () => {
    for (const ip of ["0.0.0.0", "100.64.0.1", "172.16.5.5", "172.31.255.255", "224.0.0.1", "fe80::1", "fc00::1"]) expect(isBlockedAddress(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "104.18.10.20", "172.32.0.1", "2606:4700::1"]) expect(isBlockedAddress(ip), ip).toBe(false);
  });
});
