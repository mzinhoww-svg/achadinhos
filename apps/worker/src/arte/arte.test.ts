import { criarDb, migrar, tabelas as t } from "@achadinhos/db";
import { sql } from "drizzle-orm";
import pg from "pg";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarApp } from "../app.js";
import { ArmazenamentoBanco, acharUrlPublica, VertraBlob } from "./armazenamento.js";

const URL_TESTE = process.env.DATABASE_URL_TESTE;
const TOKEN = "d".repeat(40);
const H = { "x-service-token": TOKEN };

async function fotoProduto() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900"><rect width="100%" height="100%" fill="#fff"/><circle cx="450" cy="450" r="260" fill="#c0392b"/></svg>`;
  return sharp(Buffer.from(svg)).jpeg().toBuffer();
}

describe("armazenamento", () => {
  it("acha a URL pública na resposta do Blob", () => {
    expect(acharUrlPublica({ data: { path: "a/b.jpg", public_url: "https://cdn.x/a/b.jpg" } })).toBe(
      "https://cdn.x/a/b.jpg",
    );
    expect(acharUrlPublica({ url: "https://blob.x/a.jpg", outra: "https://y" })).toBe("https://blob.x/a.jpg");
    expect(acharUrlPublica({ id: "x", link: "http://inseguro" })).toBeNull();
  });

  it("envia multipart para o Blob com o caminho no prefixo e visibilidade pública", async () => {
    let pedido: { url: string; auth: string | null; arquivo: unknown } | null = null;
    const f = (async (url: URL, init: RequestInit) => {
      pedido = {
        url: url.toString(),
        auth: new Headers(init.headers).get("authorization"),
        arquivo: (init.body as FormData).get("file"),
      };
      return new Response(
        JSON.stringify({ object: { publicUrl: "https://cdn.vertra/achadinhos/pecas/x.jpg" } }),
      );
    }) as unknown as typeof fetch;
    const b = new VertraBlob("k".repeat(20), "https://blob.vertracloud.app/v1", "achadinhos/pecas", f);
    const url = await b.gravar("2026-11-18/1-ab/quadrado.jpg", Buffer.from("x"), "image/jpeg");
    expect(url).toBe("https://cdn.vertra/achadinhos/pecas/x.jpg");
    expect(pedido).toMatchObject({ auth: `Bearer ${"k".repeat(20)}` });
    const u = new URL((pedido as unknown as { url: string }).url);
    expect(u.searchParams.get("path")).toBe("achadinhos/pecas/2026-11-18/1-ab/quadrado.jpg");
    expect(u.searchParams.get("visibility")).toBe("public");
  });
});

describe.skipIf(!URL_TESTE)("rotas da Arte", () => {
  const pool = new pg.Pool({ connectionString: URL_TESTE });
  const db = criarDb(pool);
  let fotoBuf: Buffer;
  const f = (async () => new Response(new Uint8Array(fotoBuf))) as unknown as typeof fetch;
  const app = criarApp({
    db,
    serviceToken: TOKEN,
    logLevel: "silent",
    arte: { armazenamento: new ArmazenamentoBanco(db), limiarConfianca: 0.8, publicUrl: "https://w.test", f },
  });
  let produtoId = 0;
  let ofertaId = 0;

  beforeAll(async () => {
    fotoBuf = await fotoProduto();
    await db.execute(sql`drop schema if exists achadinhos cascade`);
    await migrar(db);
    const [n] = await db.insert(t.nichos).values({ nome: "Casa e cozinha" }).returning();
    const [p] = await db
      .insert(t.produtos)
      .values({
        marketplace: "fake",
        idExterno: "1",
        nome: "Panela",
        url: "https://x/1",
        fotoUrl: "https://down-br.img.susercontent.com/file/abc_tn",
        precoAtual: "39.90",
        precoMax: "59.90",
        nichoId: n?.id,
      })
      .returning();
    produtoId = p?.id ?? 0;
    const [o] = await db
      .insert(t.ofertas)
      .values({ produtoId, nichoId: n?.id, preco: "39.90", medianaPreco30d: "59.90", descontoPct: "33.39" })
      .returning();
    ofertaId = o?.id ?? 0;
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it("renderiza a oferta nos dois formatos e guarda com URL pública", async () => {
    const r = await app.inject({ method: "POST", url: "/imagem/render", headers: H, payload: { ofertaId } });
    expect(r.statusCode).toBe(201);
    const b = r.json();
    expect(b).toMatchObject({
      ofertaId,
      origemPreco: "oferta",
      fallback: false,
      fotoOriginalUrl: "https://down-br.img.susercontent.com/file/abc",
      armazenamento: "banco",
      template: "padrao",
    });
    expect(b.pecas.map((p: { formato: string }) => p.formato)).toEqual(["quadrado", "retrato"]);
    const caminho = new URL(b.pecas[0].url).pathname;
    expect(caminho).toMatch(/^\/arquivos\/.+\/quadrado\.jpg$/);
    // Público, sem token.
    const img = await app.inject({ url: caminho });
    expect(img.statusCode).toBe(200);
    expect(img.headers["content-type"]).toBe("image/jpeg");
    expect((await sharp(img.rawPayload).metadata()).width).toBe(1080);
  }, 30_000);

  it("usa o template do nicho da bíblia e cai no fallback quando forçado", async () => {
    await app.inject({
      method: "POST",
      url: "/biblia",
      headers: H,
      payload: {
        slug: "TEMPLATES-VISUAIS",
        autor: "teste",
        conteudo: `\`\`\`json\n${JSON.stringify({ nichos: { "casa e cozinha": { cores: { destaque: "#0A7D4F" } } } })}\n\`\`\``,
      },
    });
    const r = await app.inject({
      method: "POST",
      url: "/imagem/render",
      headers: H,
      payload: { produtoId, formato: "retrato", forcarFallback: true },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({
      origemPreco: "previa",
      template: "biblia-nicho",
      fallback: true,
      motivoFallback: "fallback forçado",
    });
    const lista = (await app.inject({ url: "/imagens", headers: H })).json();
    expect(lista.renderizacoes).toHaveLength(2);
    expect(lista.renderizacoes[0]).toMatchObject({ fallback: true, produto: { nome: "Panela" } });
    const ev = (await app.inject({ url: "/eventos?tipo=arte.fallback", headers: H })).json().eventos;
    expect(ev).toHaveLength(1);
  }, 30_000);

  it("valida a entrada e protege as rotas", async () => {
    expect(
      (await app.inject({ method: "POST", url: "/imagem/render", payload: { ofertaId } })).statusCode,
    ).toBe(401);
    const r = await app.inject({ method: "POST", url: "/imagem/render", headers: H, payload: {} });
    expect(r.statusCode).toBe(400);
    expect((await app.inject({ url: "/arquivos/nao-existe.jpg" })).statusCode).toBe(404);
  });
});

describe("lote variado", () => {
  it("anúncios do mesmo produto em tamanhos diferentes caem na mesma família", async () => {
    const { familiaDoNome } = await import("./servico.js");
    expect(familiaDoNome("Pote Hermético tampa de Bambu 200ML Kit 3/6")).toBe(
      familiaDoNome("Pote Hermético tampa de Bambu 210ML Kit 3/6 Potes"),
    );
    expect(familiaDoNome("Pote Hermético tampa")).not.toBe(familiaDoNome("Organizador de gaveta"));
  });
});
