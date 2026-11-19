import { criarDb, migrar, tabelas as t } from "@achadinhos/db";
import { FakeAdapter } from "@achadinhos/marketplace";
import { eq, sql } from "drizzle-orm";
import pg from "pg";
import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarApp } from "../app.js";
import { lerConfig } from "../config.js";
import { agendarMonitor, FILA_MONITOR } from "./job.js";
import { criarMarketplaces } from "./marketplaces.js";
import { REGRAS_PADRAO } from "./regras.js";

const URL_TESTE = process.env.DATABASE_URL_TESTE;
const TOKEN = "c".repeat(40);
const H = { "x-service-token": TOKEN };

describe.skipIf(!URL_TESTE)("coleta, Monitor e ofertas (adaptador fake)", () => {
  const pool = new pg.Pool({ connectionString: URL_TESTE });
  const db = criarDb(pool);
  const fake = new FakeAdapter();
  const config = lerConfig({ DATABASE_URL: URL_TESTE, SERVICE_TOKEN: TOKEN, MARKETPLACE: "fake" });
  const marketplaces = criarMarketplaces(db, config, fake);
  const app = criarApp({ db, serviceToken: TOKEN, logLevel: "silent", marketplaces, regras: REGRAS_PADRAO });
  let nichoId = 0;

  const idProduto = async (externo: string) => {
    const [p] = await db
      .select({ id: t.produtos.id })
      .from(t.produtos)
      .where(eq(t.produtos.idExterno, externo));
    if (!p) throw new Error(`produto ${externo} não gravado`);
    return p.id;
  };
  /** Histórico antigo: um preço por dia nos últimos `n` dias. */
  const semearHistorico = async (externo: string, preco: number, n = 5) => {
    const id = await idProduto(externo);
    for (let d = 1; d <= n; d++) {
      await db
        .insert(t.historicoPrecos)
        .values({ produtoId: id, preco: String(preco), coletadoEm: new Date(Date.now() - d * 86_400_000) });
    }
    return id;
  };

  beforeAll(async () => {
    await db.execute(sql`drop schema if exists achadinhos cascade`);
    await migrar(db);
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it("cadastra o nicho com palavras-chave e regras", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/nichos",
      headers: H,
      payload: {
        nome: "Casa até R$ 100",
        palavras: ["pote", "Organizador", "luminária", "toalha", "fita", "pote"],
        precoMax: 100,
        marketplace: "fake",
      },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({
      descontoMinPct: "15.00",
      palavras: ["pote", "organizador", "luminária", "toalha", "fita"],
    });
    nichoId = r.json().id;
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/nichos",
          headers: H,
          payload: { nome: "ML", palavras: ["panela"], marketplace: "mercadolivre" },
        })
      ).statusCode,
    ).toBe(501);
  });

  it("coleta grava os produtos e não duplica numa segunda busca (dedupe por marketplace + id)", async () => {
    const r1 = await app.inject({ method: "POST", url: "/coleta/buscar", headers: H, payload: { nichoId } });
    expect(r1.statusCode).toBe(200);
    expect(r1.json()).toMatchObject({ produtos: 6, novos: 6, atualizados: 0, observacoes: 6 });
    const r2 = await app.inject({
      method: "POST",
      url: "/coleta/buscar",
      headers: H,
      payload: { nicho: "Casa até R$ 100" },
    });
    expect(r2.json()).toMatchObject({ produtos: 6, novos: 0, atualizados: 6, observacoes: 0 });
    const [{ total } = { total: 0 }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(t.produtos);
    expect(total).toBe(6);
    const [p] = await db.select().from(t.produtos).where(eq(t.produtos.idExterno, "9001"));
    expect(p).toMatchObject({
      linkAfiliado: "https://fake.example/af/9001",
      precoAtual: "59.90",
      acompanhado: true,
      nichoId,
    });
    const lista = (await app.inject({ url: `/produtos?nichoId=${nichoId}`, headers: H })).json();
    expect(lista).toMatchObject({ total: 6, comLinkAfiliado: 6, acompanhados: 6 });
  });

  it("produto sem histórico suficiente não vira oferta", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/ofertas",
      headers: H,
      payload: { produtoId: await idProduto("9005") },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json()).toMatchObject({ erro: "nao_e_oferta", motivo: "historico_insuficiente" });
  });

  it("preço forçado para baixo no fake gera oferta candidata (e evento oferta_detectada)", async () => {
    const id = await semearHistorico("9001", 59.9);
    await semearHistorico("9003", 48); // vai cair só 6%: não é oferta
    await semearHistorico("9004", 39.9); // cai 50%, mas nota 4,2: não é oferta
    fake.definirPreco("9001", 39.9);
    fake.definirPreco("9003", 45);
    fake.definirPreco("9004", 19.9);
    const m = await app.inject({ method: "POST", url: "/monitor/rodar", headers: H, payload: {} });
    expect(m.statusCode).toBe(200);
    expect(m.json()).toMatchObject({ ofertas: 1, falhas: 0 });
    const lista = (await app.inject({ url: "/ofertas?status=candidata", headers: H })).json().ofertas;
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ preco: 39.9, mediana30d: 59.9, descontoPct: 33.39, produto: { id } });
    expect(lista[0].pontuacao).toBeGreaterThan(0);
    const ev = (await app.inject({ url: "/eventos?tipo=oferta_detectada", headers: H })).json().eventos;
    expect(ev[0]).toMatchObject({ agente: "Monitor", ofertaId: lista[0].id, dados: { descontoPct: 33.39 } });
    // Histórico cresceu com o preço novo.
    const h = (await app.inject({ url: `/precos/historico?produtoId=${id}`, headers: H })).json();
    expect(h.observacoes.at(-1)).toMatchObject({ preco: 39.9 });
    expect(h.observacoes.length).toBe(7);
    // Os outros dois foram avaliados e recusados pelo motivo certo.
    const r3 = (
      await app.inject({
        method: "POST",
        url: "/ofertas",
        headers: H,
        payload: { produtoId: await idProduto("9003") },
      })
    ).json();
    expect(r3.motivo).toBe("desconto_insuficiente");
    const r4 = (
      await app.inject({
        method: "POST",
        url: "/ofertas",
        headers: H,
        payload: { produtoId: await idProduto("9004") },
      })
    ).json();
    expect(r4.motivo).toBe("avaliacao_baixa");
  });

  it("não abre segunda oferta para o mesmo produto e ordena pela pontuação", async () => {
    const dup = await app.inject({
      method: "POST",
      url: "/ofertas",
      headers: H,
      payload: { produtoId: await idProduto("9001") },
    });
    expect(dup.statusCode).toBe(409);
    await semearHistorico("9005", 74.9);
    fake.definirPreco("9005", 44.9); // −40%, nota 4,9
    await app.inject({ method: "POST", url: "/monitor/rodar", headers: H, payload: {} });
    const lista = (await app.inject({ url: "/ofertas", headers: H })).json().ofertas;
    expect(lista).toHaveLength(2);
    expect(lista[0].pontuacao).toBeGreaterThanOrEqual(lista[1].pontuacao);
    expect(lista[0].produto.idExterno).toBe("9005");
  });

  it("produto que some do marketplace deixa de ser acompanhado", async () => {
    fake.remover("9002");
    await app.inject({ method: "POST", url: "/monitor/rodar", headers: H, payload: {} });
    const [p] = await db.select().from(t.produtos).where(eq(t.produtos.idExterno, "9002"));
    expect(p).toMatchObject({ acompanhado: false, emEstoque: false });
  });

  it("o Monitor roda sozinho pela fila (pg-boss)", async () => {
    const boss = new PgBoss({ connectionString: URL_TESTE, schema: "achadinhos_fila_teste" });
    await boss.start();
    try {
      await agendarMonitor(boss, db, marketplaces, {
        cron: "0 */2 * * *",
        maxDetalhes: 100,
        regras: REGRAS_PADRAO,
        log: { info: () => {}, warn: () => {} },
      });
      const antes = (await app.inject({ url: "/eventos?tipo=monitor.concluido", headers: H })).json().eventos
        .length;
      await boss.send(FILA_MONITOR, {});
      const limite = Date.now() + 15_000;
      let depois = antes;
      while (depois === antes && Date.now() < limite) {
        await new Promise((r) => setTimeout(r, 300));
        depois = (await app.inject({ url: "/eventos?tipo=monitor.concluido", headers: H })).json().eventos
          .length;
      }
      expect(depois).toBe(antes + 1);
      const agendas = await db.execute(sql`select name, cron from achadinhos_fila_teste.schedule`);
      expect(agendas.rows).toEqual([expect.objectContaining({ name: FILA_MONITOR, cron: "0 */2 * * *" })]);
    } finally {
      await boss.stop({ graceful: false, timeout: 1000 });
    }
  });

  it("sem credencial da Shopee a coleta responde 503 com o motivo", async () => {
    const semShopee = criarMarketplaces(db, lerConfig({ DATABASE_URL: URL_TESTE, SERVICE_TOKEN: TOKEN }));
    const app2 = criarApp({ db, serviceToken: TOKEN, logLevel: "silent", marketplaces: semShopee });
    const r = await app2.inject({ method: "POST", url: "/coleta/buscar", headers: H, payload: { nichoId } });
    expect(r.statusCode).toBe(503);
    expect(r.json().mensagem).toMatch(/SHOPEE_APP_ID/);
    await app2.close();
  });
});
