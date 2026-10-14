import { describe, expect, it } from "vitest";
import { downloadProductImage } from "../src/image.js";
import { PNG } from "./helpers.js";

const base = { allowedHosts: ["cf.shopee.com.br"], maxBytes: 100, timeoutMs: 1000 };
const ok = (async () => new Response(PNG, { headers: { "content-type": "image/png" } })) as unknown as typeof fetch;

describe("downloadProductImage", () => {
  it("aceita https na allowlist com magic bytes de png", async () => {
    const r = await downloadProductImage("https://cf.shopee.com.br/a.png", { ...base, fetch: ok });
    expect(r.mime).toBe("image/png");
    expect(r.bytes.length).toBe(PNG.length);
  });
  it.each([
    ["http://cf.shopee.com.br/a.png", "protocolo"],
    ["https://evil.example.com/a.png", "host"],
    ["https://127.0.0.1/a.png", "host"],
    ["https://cf.shopee.com.br.evil.com/a.png", "host"],
  ])("rejeita %s", async (url, code) => {
    await expect(downloadProductImage(url, { ...base, fetch: ok })).rejects.toMatchObject({ code });
  });
  it("rejeita corpo acima do limite", async () => {
    const big = (async () => new Response(new Uint8Array(500).fill(0x89))) as unknown as typeof fetch;
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
  it("não segue redirect", async () => {
    let init: RequestInit | undefined;
    const f = (async (_u: string, i?: RequestInit) => ((init = i), new Response(PNG))) as unknown as typeof fetch;
    await downloadProductImage("https://cf.shopee.com.br/a", { ...base, fetch: f });
    expect(init?.redirect).toBe("error");
  });
});
