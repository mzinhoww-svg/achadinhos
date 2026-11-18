import { criarDb, migrar, tabelas as t } from "@achadinhos/db";
import { FakeAdapter } from "@achadinhos/marketplace";
import { eq, sql } from "drizzle-orm";
import pg from "pg";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarApp } from "../app.js";
import { ArmazenamentoBanco } from "../arte/armazenamento.js";
import { tokenAgente } from "../mcp/ferramentas.js";
import { Alertas } from "./controle.js";
import { copyModeloFixo, validarCopy } from "./copy.js";
import { type DepsCiclo, escolherHorario, executarDevidos, horarioBrt } from "./disparo.js";
import { Gateway } from "./gateway.js";
import { openbotCalado, rodarCicloReserva } from "./job.js";
import { regrasEnvio } from "./regras.js";

const URL_TESTE = process.env.DATABASE_URL_TESTE;
const TOKEN = "e".repeat(40);
const HOOK = "h".repeat(32);
const H = { "x-service-token": TOKEN };
const JID = "120363000000000009@g.us";
const TOM = {
  identificacoes: ["#publi"],
  maxCaracteres: 600,
  identificacaoPadrao: "#publi · link de afiliado",
};

describe("copy: validador", () => {
  const d = {
    nome: "Pote Hermético de Vidro com Tampa de Bambu",
    preco: 39.9,
    precoAntigo: 59.9,
    descontoPct: 33.39,
    ensaio: false,
  };
  it("o modelo fixo passa no validador", () => {
    for (const c of copyModeloFixo(d, TOM)) expect(validarCopy(c, d, TOM)).toEqual([]);
  });
  it("reprova preço inventado, desconto errado, falta de publi, link e produto", () => {
    const erros = validarCopy("Só hoje por R$ 29,90 com 50% off! Corre!", d, TOM);
    expect(erros.join(" | ")).toMatch(/preço da oferta/);
    expect(erros.join(" | ")).toMatch(/R\$ 29,90 não bate/);
    expect(erros.join(" | ")).toMatch(/50% não bate/);
    expect(erros.join(" | ")).toMatch(/identificação de publicidade/);
    expect(erros.join(" | ")).toMatch(/\{\{link\}\}/);
    expect(erros.join(" | ")).toMatch(/não cita o produto/);
  });
});

describe("disparo: escolha de horário", () => {
  const r = regrasEnvio.parse({});
  const agora = horarioBrt("2026-11-20", "09:00");
  it("oferta normal vai para o próximo horário da bíblia", () => {
    expect(escolherHorario(agora, [], r, { horarios: [], maxPorDia: null }, false)?.em).toEqual(
      horarioBrt("2026-11-20", "11:00"),
    );
  });
  it("horário ocupado pula para o seguinte; extra sai já, respeitando 20 min", () => {
    const ocupados = [
      { em: horarioBrt("2026-11-20", "11:00"), extra: false },
      { em: new Date(agora.getTime() + 5 * 60_000), extra: true },
    ];
    expect(escolherHorario(agora, ocupados, r, { horarios: [], maxPorDia: null }, false)?.em).toEqual(
      horarioBrt("2026-11-20", "14:00"),
    );
    const extra = escolherHorario(agora, ocupados, r, { horarios: [], maxPorDia: null }, true);
    expect(extra).toMatchObject({ extra: true });
    expect(extra?.em.getTime()).toBe(agora.getTime() + 25 * 60_000);
  });
  it("dia cheio (máximo por dia) vai para o dia seguinte", () => {
    const cheio = ["08:00", "11:00", "14:00", "17:00", "20:00"].map((h) => ({
      em: horarioBrt("2026-11-20", h),
      extra: false,
    }));
    expect(escolherHorario(agora, cheio, r, { horarios: [], maxPorDia: 5 }, false)?.em).toEqual(
      horarioBrt("2026-11-21", "08:00"),
    );
  });
});

describe.skipIf(!URL_TESTE)("ciclo completo com gateway falso", () => {
  const pool = new pg.Pool({ connectionString: URL_TESTE });
  const db = criarDb(pool);
  const pedidos: { metodo: string; url: string; corpo: Record<string, unknown> }[] = [];
  const fGateway = (async (url: string, init: RequestInit) => {
    const corpo = init.body ? JSON.parse(String(init.body)) : {};
    pedidos.push({ metodo: init.method ?? "GET", url, corpo });
    return new Response(
      JSON.stringify(url.endsWith("/privado") ? { ids: ["p1"] } : { id: `job-${pedidos.length}` }),
      { status: 202 },
    );
  }) as unknown as typeof fetch;
  let foto: Buffer;
  const fFoto = (async () => new Response(new Uint8Array(foto))) as unknown as typeof fetch;
  let agora = horarioBrt("2026-11-20", "09:00");
  const gateway = new Gateway("https://gw.test", "k".repeat(30), "achadinhos", fGateway);
  const fake = new FakeAdapter();
  const deps: DepsCiclo = {
    db,
    gateway,
    alertas: new Alertas(db, gateway),
    marketplace: fake,
    painelUrl: "https://painel.test",
    arte: {
      armazenamento: new ArmazenamentoBanco(db),
      baseUrl: "https://w.test",
      limiarConfianca: 0.8,
      f: fFoto,
    },
    agora: () => agora,
  };
  const app = criarApp({ db, serviceToken: TOKEN, logLevel: "silent", ciclo: { deps, webhookToken: HOOK } });
  let nichoId = 0;
  let grupoId = 0;

  beforeAll(async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900"><rect width="100%" height="100%" fill="#fff"/><rect x="250" y="200" width="400" height="500" fill="#2a6"/></svg>`;
    foto = await sharp(Buffer.from(svg)).jpeg().toBuffer();
    await db.execute(sql`drop schema if exists achadinhos cascade`);
    await migrar(db);
    const [n] = await db.insert(t.nichos).values({ nome: "Casa e cozinha" }).returning();
    nichoId = n?.id ?? 0;
    await db.insert(t.produtos).values({
      marketplace: "shopee",
      idExterno: "777",
      nome: "Pote Hermético de Vidro com Tampa de Bambu 800ml",
      url: "https://shopee.com.br/p/777",
      linkAfiliado: "https://s.shopee.com.br/afiliado777",
      fotoUrl: "https://down-br.img.susercontent.com/file/abc",
      precoAtual: "50.00",
      vendas: 900,
      nichoId,
    });
    const r = await app.inject({
      method: "POST",
      url: "/grupos",
      headers: H,
      payload: { nome: "Teste Achadinhos", waJid: JID, teste: true, nichoIds: [nichoId] },
    });
    grupoId = r.json().id;
    expect(r.json().gateway).toBe(true);
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  let codigo = "";
  it("oferta de ensaio passa por arte, copy e checagem e é agendada no próximo horário", async () => {
    const r = await app.inject({ method: "POST", url: "/ensaio/oferta", headers: H, payload: {} });
    expect(r.statusCode).toBe(201);
    const b = r.json();
    expect(b.preparo.checagem).toMatchObject({ aprovada: true, motivos: [] });
    expect(b.preparo.copy.semLlm).toBe("sem OPENROUTER_API_KEY");
    expect(b.preparo.disparo.agendados).toEqual([
      { grupoId, em: horarioBrt("2026-11-20", "11:00").toISOString(), extra: false },
    ]);
  }, 30_000);

  it("no horário, sai pelo gateway com a peça, a copy e o link curto; o webhook confirma o envio", async () => {
    agora = horarioBrt("2026-11-20", "10:59");
    expect((await executarDevidos(deps)).enviados).toBe(0);
    agora = horarioBrt("2026-11-20", "11:00");
    expect(await executarDevidos(deps)).toMatchObject({ enviados: 1, falhas: 0 });
    const envio = pedidos.find((p) => p.url.includes("/mensagem"));
    expect(envio?.url).toBe(`https://gw.test/v1/pools/achadinhos/grupos/${encodeURIComponent(JID)}/mensagem`);
    expect(String(envio?.corpo.texto)).toMatch(/\[ENSAIO\]/);
    expect(String(envio?.corpo.texto)).toMatch(/#publi/);
    expect(String(envio?.corpo.imagem)).toMatch(/^https:\/\/w\.test\/arquivos\/.+\/retrato\.jpg$/);
    codigo = /painel\.test\/r\/([A-Za-z0-9]+)/.exec(String(envio?.corpo.texto))?.[1] ?? "";
    expect(codigo).toHaveLength(7);
    const ref = String(envio?.corpo.ref);
    expect(
      (await app.inject({ method: "POST", url: "/wa/webhook?t=errado", payload: { type: "pool.envio" } }))
        .statusCode,
    ).toBe(401);
    const w = await app.inject({
      method: "POST",
      url: `/wa/webhook?t=${HOOK}`,
      payload: { type: "pool.envio", ref, status: "enviado", instanceId: "ach-1", at: agora.toISOString() },
    });
    expect(w.json()).toEqual({ tratado: true });
    const [e] = await db.select().from(t.envios);
    expect(e).toMatchObject({ status: "enviado", numeroGateway: "ach-1" });
    const [o] = await db
      .select()
      .from(t.ofertas)
      .where(eq(t.ofertas.id, e?.ofertaId ?? 0));
    expect(o?.status).toBe("enviada");
  });

  it("o clique no link curto é registrado com o grupo certo e redireciona para o afiliado", async () => {
    const r = await app.inject({
      method: "POST",
      url: `/links/${codigo}/clique`,
      headers: H,
      payload: { ipHash: "abc", userAgent: "Android" },
    });
    expect(r.json()).toMatchObject({ destino: "https://s.shopee.com.br/afiliado777", grupoId });
    const [link] = await db.select().from(t.links);
    expect(link?.subIds).toMatchObject({
      grupo: `g${grupoId}`,
      nicho: `n${nichoId}`,
      horario: "h1100",
      codigo,
    });
    const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(t.cliques);
    expect(n).toBe(1);
  });

  it("oferta com defeito forçado é reprovada com o motivo", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/ensaio/oferta",
      headers: H,
      payload: { defeito: "preco" },
    });
    expect(r.json().preparo.checagem).toMatchObject({
      aprovada: false,
      motivos: [expect.objectContaining({ codigo: "preco_diferente" })],
    });
    const ch = (await app.inject({ url: "/checagens", headers: H })).json().checagens;
    expect(ch[0]).toMatchObject({ aprovada: false });
  }, 30_000);

  it("PAUSAR para tudo na hora; RETOMAR pelo WhatsApp volta e avisa no privado", async () => {
    await app.inject({ method: "POST", url: "/ensaio/oferta", headers: H, payload: { descontoPct: 45 } });
    const p = await app.inject({
      method: "POST",
      url: "/pausa",
      headers: H,
      payload: { pausado: true, motivo: "teste", autor: "painel" },
    });
    expect(p.json()).toMatchObject({ pausado: true, por: "painel" });
    agora = new Date(agora.getTime() + 3 * 3_600_000);
    expect(await executarDevidos(deps)).toMatchObject({ pausado: true, enviados: 0 });
    pedidos.length = 0;
    await app.inject({
      method: "POST",
      url: `/wa/webhook?t=${HOOK}`,
      payload: { type: "pool.comando", comando: "RETOMAR" },
    });
    expect((await app.inject({ url: "/pausa", headers: H })).json().pausado).toBe(false);
    expect(
      pedidos.some((x) => x.url.endsWith("/privado") && String(x.corpo.texto).includes("retomado")),
    ).toBe(true);
    expect((await executarDevidos(deps)).enviados).toBe(1);
  }, 30_000);

  it("painel: resumo, métricas por grupo, links com cliques, detalhe da oferta e auditoria", async () => {
    const m = (await app.inject({ url: "/metricas?recorte=grupo&dias=30", headers: H })).json();
    expect(m.linhas[0]).toMatchObject({ chave: "Teste Achadinhos", cliques: 1, conversoes: 0 });
    const l = (await app.inject({ url: "/links?dias=30", headers: H })).json();
    expect(l.links.find((x: { codigo: string }) => x.codigo === codigo)).toMatchObject({
      cliques: 1,
      unicos: 1,
      grupo: "Teste Achadinhos",
    });
    const r = (await app.inject({ url: "/painel/resumo", headers: H })).json();
    expect(r).toHaveProperty("ofertas.avaliadas");
    expect(r.llm).toMatchObject({ tetoDiario: 1 });
    const [o] = await db.select().from(t.ofertas).limit(1);
    const det = (await app.inject({ url: `/ofertas/${o?.id}`, headers: H })).json();
    expect(det.imagens.length).toBeGreaterThan(0);
    expect(det.copies.length).toBeGreaterThan(0);
    expect(det.checagens[0]).toMatchObject({ aprovada: true });
    const a = await app.inject({
      method: "POST",
      url: "/auditoria",
      headers: H,
      payload: { ator: "Aurimar (painel)", acao: "nicho.alterado", alvo: "nicho:1" },
    });
    expect(a.statusCode).toBe(201);
    expect((await app.inject({ url: "/auditoria", headers: H })).json().registros[0]).toMatchObject({
      acao: "nicho.alterado",
    });
  });

  it("preço que subiu antes do envio cancela e avisa", async () => {
    // oferta real (não ensaio) de um produto do adaptador falso: 9001 custa 59,90 no fake
    const [prod] = await db
      .insert(t.produtos)
      .values({
        marketplace: "fake",
        idExterno: "9001",
        nome: "Pote fake",
        url: "https://fake.example/9001",
        precoAtual: "39.90",
        nichoId,
      })
      .returning();
    const [of] = await db
      .insert(t.ofertas)
      .values({
        produtoId: prod?.id ?? 0,
        nichoId,
        preco: "39.90",
        medianaPreco30d: "59.90",
        descontoPct: "33.39",
        status: "agendada",
      })
      .returning();
    await db.insert(t.envios).values({
      ofertaId: of?.id ?? 0,
      grupoId,
      chaveIdempotente: `x:${of?.id}`,
      status: "agendado",
      agendadoPara: agora,
    });
    pedidos.length = 0;
    expect(await executarDevidos(deps)).toMatchObject({ cancelados: 1, enviados: 0 });
    const [o2] = await db
      .select()
      .from(t.ofertas)
      .where(eq(t.ofertas.id, of?.id ?? 0));
    expect(o2).toMatchObject({ status: "cancelada", motivoReprovacao: expect.stringMatching(/preço subiu/) });
    expect(
      pedidos.some((x) => x.url.endsWith("/privado") && String(x.corpo.texto).includes("cancelado")),
    ).toBe(true);
  });

  it("MCP: cada agente vê só as suas ferramentas e age com o próprio nome", async () => {
    const rpc = (agente: Parameters<typeof tokenAgente>[1] | null, method: string, params?: unknown) =>
      app.inject({
        method: "POST",
        url: "/mcp",
        headers: agente ? { authorization: `Bearer ${tokenAgente(TOKEN, agente)}` } : {},
        payload: { jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) },
      });
    expect((await rpc(null, "tools/list")).statusCode).toBe(401);
    const init = (await rpc("Garimpeiro", "initialize", { protocolVersion: "2025-06-18" })).json();
    expect(init.result.serverInfo.name).toBe("achadinhos-worker");
    const nomes = (await rpc("Garimpeiro", "tools/list"))
      .json()
      .result.tools.map((x: { name: string }) => x.name);
    expect(nomes).toContain("buscar_produtos");
    expect(nomes).not.toContain("gravar_biblia");
    expect(nomes).not.toContain("agendar_disparo");
    const negado = (
      await rpc("Garimpeiro", "tools/call", {
        name: "definir_pausa",
        arguments: { pausado: true, motivo: "x" },
      })
    ).json();
    expect(negado.error.message).toMatch(/não é permitida/);
    expect(await openbotCalado(deps)).toBe(true);
    const ok = (
      await rpc("Coordenador", "tools/call", {
        name: "definir_pausa",
        arguments: { pausado: false, motivo: "teste mcp" },
      })
    ).json();
    expect(ok.result.isError).toBe(false);
    expect(JSON.parse(ok.result.content[0].text)).toMatchObject({ pausado: false, por: "Coordenador" });
    expect(await openbotCalado(deps)).toBe(false);
    expect(await rodarCicloReserva(deps, "reserva")).toMatchObject({
      rodou: false,
      motivo: "agentes ativos",
    });
    const biblia = (await rpc("Copywriter", "tools/call", { name: "ler_biblia", arguments: {} })).json();
    expect(JSON.parse(biblia.result.content[0].text)).toHaveProperty("documentos");
    // Token na URL, para clientes que não gravam cabeçalho
    const viaUrl = await app.inject({
      method: "POST",
      url: `/mcp/${tokenAgente(TOKEN, "Monitor")}`,
      payload: { jsonrpc: "2.0", id: 2, method: "tools/list" },
    });
    expect(viaUrl.json().result.tools.map((x: { name: string }) => x.name)).toContain("rodar_monitor");
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/mcp/ach_errado",
          payload: { jsonrpc: "2.0", id: 3, method: "tools/list" },
        })
      ).statusCode,
    ).toBe(401);
    const ag = (await app.inject({ url: "/agentes", headers: H })).json();
    expect(ag.agentes).toHaveLength(6);
    expect(ag.mcpUrl).toBe("https://w.test/mcp");
  });

  it("resumo do dia sai no privado do dono pelo gateway, uma vez por dia", async () => {
    pedidos.length = 0;
    const r = await app.inject({
      method: "POST",
      url: "/resumo/enviar",
      headers: H,
      payload: { observacoes: "dia de ensaio" },
    });
    expect(r.json()).toMatchObject({ enviado: true });
    expect(r.json().texto).toMatch(/resumo de/);
    expect(r.json().texto).toMatch(/Coordenador: dia de ensaio/);
    expect(pedidos.filter((x) => x.url.endsWith("/privado"))).toHaveLength(1);
    const { resumoReserva } = await import("./resumo.js");
    expect(await resumoReserva(db, deps.alertas)).toMatchObject({
      enviado: false,
      motivo: "já enviado hoje",
    });
    const c = await app.inject({
      method: "POST",
      url: "/custos",
      headers: H,
      payload: { agente: "Copywriter", modelo: "x/y", custoUsd: 0.002 },
    });
    expect(c.json().gastoLlmUsd.dia).toBeGreaterThan(0);
  });

  it("3 falhas seguidas de envio pausam sozinho", async () => {
    for (let i = 0; i < 3; i++)
      await app.inject({
        method: "POST",
        url: `/wa/webhook?t=${HOOK}`,
        payload: { type: "pool.envio", ref: "envio:1", status: "falhou", erro: "x" },
      });
    expect((await app.inject({ url: "/pausa", headers: H })).json()).toMatchObject({
      pausado: true,
      por: "trava automática",
    });
  });
});
