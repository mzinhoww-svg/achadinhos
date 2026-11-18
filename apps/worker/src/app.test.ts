import type { AddressInfo } from "node:net";
import { criarDb, migrar, tabelas as t } from "@achadinhos/db";
import { sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarApp } from "./app.js";
import { OuvinteEventos } from "./ouvinte.js";
import { gerarHashSenha } from "./senha.js";

const URL_TESTE = process.env.DATABASE_URL_TESTE;
const TOKEN = "t".repeat(40);
const H = { "x-service-token": TOKEN };

// Precisa de um Postgres de teste (CI: serviço postgres; local: DATABASE_URL_TESTE).
describe.skipIf(!URL_TESTE)("worker com Postgres", () => {
  const pool = new pg.Pool({ connectionString: URL_TESTE });
  const db = criarDb(pool);
  const silencioso = { info: () => {}, warn: () => {} };
  const ouvinte = new OuvinteEventos({ connectionString: URL_TESTE }, silencioso);
  const app = criarApp({ db, serviceToken: TOKEN, ouvinte, logLevel: "silent" });

  beforeAll(async () => {
    await db.execute(sql`drop schema if exists achadinhos cascade`);
    await migrar(db);
    await migrar(db); // idempotente
    await db.insert(t.admins).values({
      email: "admin@exemplo.com",
      nome: "Admin",
      senhaHash: await gerarHashSenha("senha-forte-123"),
    });
    await ouvinte.iniciar();
    await app.listen({ port: 0, host: "127.0.0.1" });
  });
  afterAll(async () => {
    await app.close();
    await ouvinte.parar();
    await pool.end();
  });

  it("/health é público e confere o banco", async () => {
    const r = await app.inject({ url: "/health" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true, banco: true });
  });

  it("exige X-Service-Token", async () => {
    expect((await app.inject({ url: "/biblia" })).statusCode).toBe(401);
    expect((await app.inject({ url: "/biblia", headers: { "x-service-token": "errado" } })).statusCode).toBe(
      401,
    );
  });

  it("grava, versiona e lê documentos da bíblia", async () => {
    const v1 = await app.inject({
      method: "POST",
      url: "/biblia",
      headers: H,
      payload: { slug: "biblia.md", titulo: "Bíblia", conteudo: "v1", autor: "Coordenador" },
    });
    expect(v1.statusCode).toBe(201);
    expect(v1.json()).toMatchObject({ slug: "BIBLIA", versao: 1 });
    const v2 = await app.inject({
      method: "POST",
      url: "/biblia",
      headers: H,
      payload: { slug: "BIBLIA", conteudo: "v2", autor: "Coordenador", motivo: "ajuste" },
    });
    expect(v2.json()).toMatchObject({ versao: 2, titulo: "Bíblia" });
    expect((await app.inject({ url: "/biblia/BIBLIA", headers: H })).json()).toMatchObject({
      versao: 2,
      conteudo: "v2",
    });
    expect((await app.inject({ url: "/biblia/BIBLIA?versao=1", headers: H })).json()).toMatchObject({
      conteudo: "v1",
    });
    expect((await app.inject({ url: "/biblia/BIBLIA/versoes", headers: H })).json().versoes).toHaveLength(2);
    const lista = (await app.inject({ url: "/biblia", headers: H })).json().documentos;
    expect(lista).toEqual([expect.objectContaining({ slug: "BIBLIA", versao: 2, tamanho: 2 })]);
    expect((await app.inject({ url: "/biblia/NAO-EXISTE", headers: H })).statusCode).toBe(404);
  });

  it("valida a entrada", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/biblia",
      headers: H,
      payload: { slug: "../x", conteudo: "a", autor: "x" },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().erro).toBe("entrada_invalida");
  });

  it("aprovar proposta grava nova versão; decidir duas vezes dá 409", async () => {
    const p = await app.inject({
      method: "POST",
      url: "/propostas",
      headers: H,
      payload: {
        titulo: "Novo tom",
        descricao: "Mais curto",
        autor: "Copywriter",
        docSlug: "TOM-DE-VOZ",
        conteudoProposto: "Curto e direto.",
      },
    });
    expect(p.statusCode).toBe(201);
    const id = p.json().id as number;
    expect((await app.inject({ url: "/propostas?status=aberta", headers: H })).json().propostas).toHaveLength(
      1,
    );
    const d = await app.inject({
      method: "POST",
      url: `/propostas/${id}/decidir`,
      headers: H,
      payload: { decisao: "aprovada", decididoPor: "Coordenador" },
    });
    expect(d.statusCode).toBe(200);
    expect(d.json()).toMatchObject({
      proposta: { status: "aprovada" },
      doc: { slug: "TOM-DE-VOZ", versao: 1, conteudo: "Curto e direto." },
    });
    const de = await app.inject({
      method: "POST",
      url: `/propostas/${id}/decidir`,
      headers: H,
      payload: { decisao: "rejeitada", decididoPor: "Aurimar" },
    });
    expect(de.statusCode).toBe(409);
  });

  it("registra eventos e entrega pelo stream (LISTEN/NOTIFY)", async () => {
    const endereco = app.server.address() as AddressInfo;
    const base = `http://127.0.0.1:${endereco.port}`;
    const controle = new AbortController();
    const res = await fetch(`${base}/eventos/stream`, { headers: H, signal: controle.signal });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    if (!res.body) throw new Error("stream sem corpo");
    const leitor = res.body.getReader();
    await new Promise((r) => setTimeout(r, 200));
    const criado = await app.inject({
      method: "POST",
      url: "/eventos",
      headers: H,
      payload: { tipo: "teste.stream", agente: "Monitor", dados: { a: 1 } },
    });
    expect(criado.statusCode).toBe(201);
    let texto = "";
    const limite = Date.now() + 5000;
    while (!texto.includes("teste.stream") && Date.now() < limite) {
      const { value } = await leitor.read();
      texto += new TextDecoder().decode(value);
    }
    controle.abort();
    expect(texto).toContain('"tipo":"teste.stream"');
    const lista = (await app.inject({ url: "/eventos?tipo=teste.stream", headers: H })).json().eventos;
    expect(lista[0]).toMatchObject({ agente: "Monitor", dados: { a: 1 } });
  });

  it("ferramentas não construídas respondem 501 com o motivo", async () => {
    const r = await app.inject({ method: "POST", url: "/imagem/render", headers: H, payload: {} });
    expect(r.statusCode).toBe(501);
    expect(r.json()).toMatchObject({ erro: "nao_implementado", ferramenta: "/imagem/render" });
    expect(r.json().motivo).toBeTruthy();
    expect((await app.inject({ method: "POST", url: "/ofertas/12/checar", headers: H })).statusCode).toBe(
      501,
    );
  });

  it("troca a senha do admin exigindo a atual", async () => {
    const errada = await app.inject({
      method: "POST",
      url: "/auth/senha",
      headers: H,
      payload: { email: "admin@exemplo.com", senhaAtual: "nao-e-essa", senhaNova: "outra-senha-forte-1" },
    });
    expect(errada.statusCode).toBe(401);
    const curta = await app.inject({
      method: "POST",
      url: "/auth/senha",
      headers: H,
      payload: { email: "admin@exemplo.com", senhaAtual: "senha-forte-123", senhaNova: "curta" },
    });
    expect(curta.statusCode).toBe(400);
    const ok = await app.inject({
      method: "POST",
      url: "/auth/senha",
      headers: H,
      payload: {
        email: "admin@exemplo.com",
        senhaAtual: "senha-forte-123",
        senhaNova: "outra-senha-forte-1",
      },
    });
    expect(ok.statusCode).toBe(200);
    const volta = await app.inject({
      method: "POST",
      url: "/auth/senha",
      headers: H,
      payload: {
        email: "admin@exemplo.com",
        senhaAtual: "outra-senha-forte-1",
        senhaNova: "senha-forte-123",
      },
    });
    expect(volta.statusCode).toBe(200);
  });

  it("login do painel confere a senha e limita tentativas", async () => {
    const ok = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: H,
      payload: { email: "ADMIN@exemplo.com", senha: "senha-forte-123" },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().admin).toMatchObject({ email: "admin@exemplo.com" });
    for (let i = 0; i < 5; i++) {
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/auth/login",
            headers: H,
            payload: { email: "admin@exemplo.com", senha: "errada" },
          })
        ).statusCode,
      ).toBe(401);
    }
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/auth/login",
          headers: H,
          payload: { email: "admin@exemplo.com", senha: "senha-forte-123" },
        })
      ).statusCode,
    ).toBe(429);
  });
});
