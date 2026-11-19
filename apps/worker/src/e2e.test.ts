import { criarDb, migrar, tabelas as t } from "@achadinhos/db";
import { FakeAdapter } from "@achadinhos/marketplace";
import { eq, sql } from "drizzle-orm";
import pg from "pg";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarApp } from "./app.js";
import { ArmazenamentoBanco } from "./arte/armazenamento.js";
import { Alertas } from "./ciclo/controle.js";
import { type DepsCiclo, executarDevidos, horarioBrt } from "./ciclo/disparo.js";
import { Gateway } from "./ciclo/gateway.js";
import { rodarCicloReserva } from "./ciclo/job.js";
import { criarMarketplaces } from "./coleta/marketplaces.js";
import { REGRAS_PADRAO } from "./coleta/regras.js";
import { lerConfig } from "./config.js";

/**
 * T8.3: ciclo completo de uma oferta REAL (não ensaio) com o adaptador e o gateway falsos:
 * coleta → monitor (queda de preço) → candidata → ciclo reserva (arte, copy, checagem) → agendamento →
 * envio no horário → confirmação do gateway → clique → conversão importada → métricas e custo.
 */
const URL_TESTE = process.env.DATABASE_URL_TESTE;
const TOKEN = "f".repeat(40);
const HOOK = "w".repeat(32);
const H = { "x-service-token": TOKEN };
const JID = "120363000000000077@g.us";

describe.skipIf(!URL_TESTE)("ponta a ponta com adaptadores falsos", () => {
  const pool = new pg.Pool({ connectionString: URL_TESTE });
  const db = criarDb(pool);
  const fake = new FakeAdapter();
  const config = lerConfig({ DATABASE_URL: URL_TESTE, SERVICE_TOKEN: TOKEN, MARKETPLACE: "fake" });
  const marketplaces = criarMarketplaces(db, config, fake);
  const enviados: { url: string; corpo: Record<string, unknown> }[] = [];
  const gateway = new Gateway("https://gw.test", "k".repeat(30), "achadinhos", (async (
    url: string,
    init: RequestInit,
  ) => {
    enviados.push({ url, corpo: init.body ? JSON.parse(String(init.body)) : {} });
    return new Response(JSON.stringify({ id: `job-${enviados.length}`, ids: ["p"] }), { status: 202 });
  }) as unknown as typeof fetch);
  let foto: Buffer;
  let agora = horarioBrt("2026-11-23", "07:00");
  const deps: DepsCiclo = {
    db,
    gateway,
    alertas: new Alertas(db, gateway),
    marketplace: marketplaces.principal,
    painelUrl: "https://painel.test",
    arte: {
      armazenamento: new ArmazenamentoBanco(db),
      baseUrl: "https://w.test",
      limiarConfianca: 0.8,
      f: (async () => new Response(new Uint8Array(foto))) as unknown as typeof fetch,
    },
    agora: () => agora,
  };
  const app = criarApp({
    db,
    serviceToken: TOKEN,
    logLevel: "silent",
    marketplaces,
    regras: REGRAS_PADRAO,
    ciclo: { deps, webhookToken: HOOK },
  });

  beforeAll(async () => {
    foto = await sharp(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900"><rect width="100%" height="100%" fill="#fff"/><circle cx="450" cy="450" r="250" fill="#36c"/></svg>',
      ),
    )
      .jpeg()
      .toBuffer();
    await db.execute(sql`drop schema if exists achadinhos cascade`);
    await migrar(db);
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it("roda o ciclo inteiro sem ação manual e liga a conversão à oferta, ao grupo e ao horário", async () => {
    // 1. nicho e coleta
    const n = (
      await app.inject({
        method: "POST",
        url: "/nichos",
        headers: H,
        payload: {
          nome: "Casa",
          palavras: ["pote", "organizador", "luminária", "toalha", "fita"],
          precoMax: 100,
          marketplace: "fake",
        },
      })
    ).json();
    expect(
      (
        await app.inject({ method: "POST", url: "/coleta/buscar", headers: H, payload: { nichoId: n.id } })
      ).json().produtos,
    ).toBe(6);
    const g = (
      await app.inject({
        method: "POST",
        url: "/grupos",
        headers: H,
        payload: { nome: "Grupo E2E", waJid: JID, teste: true, nichoIds: [n.id] },
      })
    ).json();
    // 2. histórico de 5 dias e queda de preço
    const [p] = await db.select().from(t.produtos).where(eq(t.produtos.idExterno, "9001"));
    for (let d = 1; d <= 5; d++)
      await db
        .insert(t.historicoPrecos)
        .values({ produtoId: p?.id ?? 0, preco: "59.90", coletadoEm: new Date(Date.now() - d * 86_400_000) });
    fake.definirPreco("9001", 39.9);
    expect(
      (await app.inject({ method: "POST", url: "/monitor/rodar", headers: H, payload: {} })).json().ofertas,
    ).toBe(1);
    // 3. ciclo reserva prepara e agenda (OpenBot calado)
    const ciclo = await rodarCicloReserva(deps, "reserva");
    expect(ciclo).toMatchObject({ rodou: true, preparadas: [expect.objectContaining({ aprovada: true })] });
    const [envio] = await db.select().from(t.envios);
    expect(envio?.agendadoPara?.toISOString()).toBe(horarioBrt("2026-11-23", "08:00").toISOString());
    // 4. no horário, preço revalidado no fake e envio pelo gateway
    agora = horarioBrt("2026-11-23", "08:00");
    expect(await executarDevidos(deps)).toMatchObject({ enviados: 1, cancelados: 0 });
    const msg = enviados.find((e) => e.url.includes("/mensagem"));
    expect(String(msg?.corpo.texto)).toMatch(/R\$ 39,90/);
    expect(String(msg?.corpo.texto)).toMatch(/#publi/);
    const codigo = /\/r\/([A-Za-z0-9]+)/.exec(String(msg?.corpo.texto))?.[1] ?? "";
    await app.inject({
      method: "POST",
      url: `/wa/webhook?t=${HOOK}`,
      payload: {
        type: "pool.envio",
        ref: msg?.corpo.ref,
        status: "enviado",
        instanceId: "ach-1",
        at: agora.toISOString(),
      },
    });
    // 5. clique e conversão com os subIds do link
    await app.inject({
      method: "POST",
      url: `/links/${codigo}/clique`,
      headers: H,
      payload: { ipHash: "x", userAgent: "iPhone" },
    });
    const [link] = await db.select().from(t.links);
    expect(link?.urlAfiliado).toMatch(/^https:\/\/fake\.example\/s\/9001\?sub=g\d+-n\d+-o\d+-h0800-/);
    fake.conversoesSimuladas.push({
      pedido: "c1:o1",
      subIds: Object.values(link?.subIds ?? {}),
      valor: 39.9,
      comissao: 3.19,
      status: "COMPLETED",
      compradoEm: new Date(),
    });
    const imp = (
      await app.inject({ method: "POST", url: "/conversoes/importar", headers: H, payload: { dias: 7 } })
    ).json();
    expect(imp).toMatchObject({ importadas: 1, ligadas: 1 });
    const conv = (await app.inject({ url: "/conversoes?dias=7", headers: H })).json().conversoes;
    expect(conv[0]).toMatchObject({ grupo: "Grupo E2E", comissao: "3.19" });
    expect(conv[0].subIds).toMatchObject({ horario: "h0800", grupo: `g${g.id}` });
    // 6. métricas por horário e custo por agente
    const m = (await app.inject({ url: "/metricas?recorte=horario&dias=30", headers: H })).json();
    expect(m.linhas[0]).toMatchObject({
      chave: "08:00",
      enviadas: 1,
      cliques: 1,
      conversoes: 1,
      comissao: 3.19,
    });
    await app.inject({
      method: "POST",
      url: "/custos",
      headers: H,
      payload: { agente: "Copywriter", modelo: "x/y", custoUsd: 0.01 },
    });
    const c = (await app.inject({ url: "/custos?dias=7", headers: H })).json();
    expect(c).toMatchObject({ enviadas: 1, totalUsd: 0.01, custoPorOfertaEnviadaUsd: 0.01 });
    expect(c.agentes[0]).toMatchObject({ agente: "Copywriter", chamadas: 1 });
  }, 60_000);
});
