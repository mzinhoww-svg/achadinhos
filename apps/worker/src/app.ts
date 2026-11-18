import type { Db } from "@achadinhos/db";
import { tabelas as t } from "@achadinhos/db";
import {
  criarProposta as esquemaCriarProposta,
  decidirProposta as esquemaDecidirProposta,
  registrarEvento as esquemaEvento,
  FERRAMENTAS_PENDENTES,
  gravarDocBiblia,
  STATUS_PROPOSTA,
  slugBiblia,
} from "@achadinhos/shared";
import { eq, sql } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import type { Marketplaces } from "./coleta/marketplaces.js";
import { REGRAS_PADRAO, type RegrasOferta } from "./coleta/regras.js";
import { rotasColeta } from "./coleta/rotas.js";
import type { OuvinteEventos } from "./ouvinte.js";
import { conferirSenha, gerarHashSenha } from "./senha.js";
import {
  buscarEvento,
  criarProposta,
  decidirProposta,
  ErroNegocio,
  gravarDoc,
  lerDoc,
  listarDocs,
  listarEventos,
  listarPropostas,
  registrarEvento,
  versoesDoc,
} from "./servicos.js";
import { tokenConfere } from "./token.js";

export const VERSAO = "0.1.0";

export interface DepsApp {
  db: Db;
  serviceToken: string;
  ouvinte?: OuvinteEventos;
  logLevel?: string;
  /** Pg-boss, LISTEN e a preparação do banco entram no /health. `pronto: false` responde 503 nas rotas. */
  estado?: () => { fila: boolean; listen: boolean; pronto?: boolean; erro?: string | null };
  /** Coleta, Monitor e ofertas (Prompt 2). Sem isto, as rotas de coleta não são registradas. */
  marketplaces?: Marketplaces;
  regras?: RegrasOferta;
}

const ROTAS_PUBLICAS = new Set(["/health", "/"]);

export function criarApp(deps: DepsApp): FastifyInstance {
  const app = Fastify({
    logger: {
      level: deps.logLevel ?? "info",
      redact: ["req.headers.x-service-token", "req.headers.authorization", "body.senha"],
    },
    bodyLimit: 1_048_576,
    trustProxy: true,
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof z.ZodError) {
      return reply.code(400).send({
        erro: "entrada_invalida",
        detalhes: err.issues.map((i) => ({ campo: i.path.join("."), mensagem: i.message })),
      });
    }
    if (err instanceof ErroNegocio)
      return reply.code(err.status).send({ erro: err.codigo, mensagem: err.message });
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) req.log.error({ err }, "erro interno");
    return reply.code(status).send({
      erro: status >= 500 ? "erro_interno" : "requisicao_invalida",
      mensagem: status >= 500 ? "Erro interno; veja o log do worker." : (err as Error).message,
    });
  });

  // Toda rota, menos /health, exige o token entre serviços.
  app.addHook("onRequest", async (req, reply) => {
    const caminho = req.url.split("?")[0] ?? "";
    if (ROTAS_PUBLICAS.has(caminho)) return;
    if (!tokenConfere(req.headers["x-service-token"], deps.serviceToken)) {
      return reply.code(401).send({ erro: "nao_autorizado", mensagem: "Envie o header X-Service-Token." });
    }
    const e = deps.estado?.();
    if (e && e.pronto === false) {
      return reply
        .code(503)
        .send({ erro: "iniciando", mensagem: e.erro ?? "O worker ainda está preparando o banco." });
    }
  });

  app.get("/", async () => ({ servico: "achadinhos-worker", versao: VERSAO, saude: "/health" }));

  app.get("/health", async (_req, reply) => {
    let banco = false;
    try {
      await deps.db.execute(sql`select 1`);
      banco = true;
    } catch {
      banco = false;
    }
    const extra = deps.estado?.() ?? { fila: false, listen: false };
    const ok = banco && extra.pronto !== false;
    // Sempre 200, com ok e o motivo no corpo: a borda da Vertra esconde o corpo de respostas 5xx.
    return reply.code(200).send({ ok, versao: VERSAO, banco, ...extra });
  });

  // ---------- bíblia ----------
  app.get("/biblia", async () => ({ documentos: await listarDocs(deps.db) }));

  app.get("/biblia/:slug", async (req, reply) => {
    const { slug } = z.object({ slug: slugBiblia }).parse(req.params);
    const { versao } = z.object({ versao: z.coerce.number().int().positive().optional() }).parse(req.query);
    const doc = await lerDoc(deps.db, slug, versao);
    if (!doc)
      return reply.code(404).send({ erro: "nao_encontrado", mensagem: `documento ${slug} não existe` });
    return doc;
  });

  app.get("/biblia/:slug/versoes", async (req) => {
    const { slug } = z.object({ slug: slugBiblia }).parse(req.params);
    return { versoes: await versoesDoc(deps.db, slug) };
  });

  app.post("/biblia", async (req, reply) => {
    const doc = await gravarDoc(deps.db, gravarDocBiblia.parse(req.body));
    return reply.code(201).send(doc);
  });

  // ---------- propostas ----------
  app.get("/propostas", async (req) => {
    const { status } = z.object({ status: z.enum(STATUS_PROPOSTA).optional() }).parse(req.query);
    return { propostas: await listarPropostas(deps.db, status) };
  });

  app.post("/propostas", async (req, reply) => {
    return reply.code(201).send(await criarProposta(deps.db, esquemaCriarProposta.parse(req.body)));
  });

  app.post("/propostas/:id/decidir", async (req) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
    return decidirProposta(deps.db, id, esquemaDecidirProposta.parse(req.body));
  });

  // ---------- eventos ----------
  app.post("/eventos", async (req, reply) => {
    return reply.code(201).send(await registrarEvento(deps.db, esquemaEvento.parse(req.body)));
  });

  app.get("/eventos", async (req) => {
    const q = z
      .object({
        desde: z.coerce.number().int().nonnegative().optional(),
        tipo: z.string().max(80).optional(),
        limite: z.coerce.number().int().min(1).max(500).default(100),
      })
      .parse(req.query);
    return { eventos: await listarEventos(deps.db, q) };
  });

  /** Fluxo em tempo real (SSE) dos eventos, via LISTEN/NOTIFY. `desde` reenvia o que veio depois desse id. */
  app.get("/eventos/stream", async (req, reply) => {
    const { desde } = z.object({ desde: z.coerce.number().int().nonnegative().optional() }).parse(req.query);
    const ouvinte = deps.ouvinte;
    if (!ouvinte) return reply.code(503).send({ erro: "sem_listen", mensagem: "LISTEN/NOTIFY indisponível" });
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    // Sem um primeiro byte, o Node segura os cabeçalhos e o cliente fica esperando.
    res.write(": conectado\n\n");
    const enviar = (e: { id: number }) =>
      res.write(`id: ${e.id}\nevent: evento\ndata: ${JSON.stringify(e)}\n\n`);
    let ultimo = desde ?? 0;
    if (desde !== undefined)
      for (const e of await listarEventos(deps.db, { desde, limite: 500 })) {
        enviar(e);
        ultimo = e.id;
      }
    const aoEvento = async (id: number) => {
      if (id <= ultimo) return;
      const e = await buscarEvento(deps.db, id).catch(() => null);
      if (e) {
        ultimo = Math.max(ultimo, e.id);
        enviar(e);
      }
    };
    ouvinte.on("evento", aoEvento);
    const pulso = setInterval(() => res.write(": pulso\n\n"), 25_000);
    req.raw.on("close", () => {
      clearInterval(pulso);
      ouvinte.off("evento", aoEvento);
    });
  });

  // ---------- login do painel ----------
  // O painel não acessa o banco: confere a senha aqui, com o token entre serviços.
  const tentativas = new Map<string, { n: number; desde: number }>();
  app.post("/auth/login", async (req, reply) => {
    const { email, senha } = z
      .object({ email: z.string().trim().toLowerCase().email(), senha: z.string().min(1).max(256) })
      .parse(req.body);
    const agora = Date.now();
    const tent = tentativas.get(email);
    if (tent && agora - tent.desde < 15 * 60_000 && tent.n >= 5) {
      return reply
        .code(429)
        .send({ erro: "muitas_tentativas", mensagem: "Muitas tentativas. Aguarde 15 minutos." });
    }
    const [admin] = await deps.db.select().from(t.admins).where(eq(t.admins.email, email));
    const ok = await conferirSenha(senha, admin?.ativo ? admin.senhaHash : null);
    if (!ok || !admin) {
      const atual = tent && agora - tent.desde < 15 * 60_000 ? tent : { n: 0, desde: agora };
      atual.n++;
      tentativas.set(email, atual);
      await deps.db.insert(t.auditoria).values({ ator: email, acao: "login.recusado", alvo: "painel" });
      return reply.code(401).send({ erro: "credenciais_invalidas", mensagem: "E-mail ou senha inválidos." });
    }
    tentativas.delete(email);
    await deps.db.update(t.admins).set({ ultimoLoginEm: new Date() }).where(eq(t.admins.id, admin.id));
    await deps.db.insert(t.auditoria).values({ ator: email, acao: "login.ok", alvo: "painel" });
    return { admin: { id: admin.id, email: admin.email, nome: admin.nome } };
  });

  /** Troca de senha do admin pelo painel: exige a senha atual. */
  app.post("/auth/senha", async (req, reply) => {
    const b = z
      .object({
        email: z.string().trim().toLowerCase().email(),
        senhaAtual: z.string().min(1).max(256),
        senhaNova: z.string().min(12, "a senha nova precisa de pelo menos 12 caracteres").max(256),
      })
      .parse(req.body);
    const [admin] = await deps.db.select().from(t.admins).where(eq(t.admins.email, b.email));
    const ok = await conferirSenha(b.senhaAtual, admin?.ativo ? admin.senhaHash : null);
    if (!ok || !admin) {
      await deps.db.insert(t.auditoria).values({ ator: b.email, acao: "senha.recusada", alvo: "painel" });
      return reply.code(401).send({ erro: "credenciais_invalidas", mensagem: "Senha atual incorreta." });
    }
    if (b.senhaNova === b.senhaAtual) {
      return reply
        .code(400)
        .send({ erro: "entrada_invalida", mensagem: "A senha nova precisa ser diferente da atual." });
    }
    await deps.db
      .update(t.admins)
      .set({ senhaHash: await gerarHashSenha(b.senhaNova) })
      .where(eq(t.admins.id, admin.id));
    await deps.db.insert(t.auditoria).values({ ator: b.email, acao: "senha.trocada", alvo: "painel" });
    return { ok: true };
  });

  // ---------- ferramentas ainda não construídas ----------
  for (const f of FERRAMENTAS_PENDENTES) {
    app.route({
      method: f.metodo,
      url: f.rota,
      handler: async (_req, reply) =>
        reply.code(501).send({
          erro: "nao_implementado",
          ferramenta: f.ferramenta,
          quemChama: f.quemChama,
          motivo: f.motivo,
        }),
    });
  }

  if (deps.marketplaces) rotasColeta(app, deps.db, deps.marketplaces, deps.regras ?? REGRAS_PADRAO);

  app.get("/ferramentas", async () => ({
    prontas: [
      "GET /health",
      "GET /biblia",
      "GET /biblia/:slug",
      "GET /biblia/:slug/versoes",
      "POST /biblia",
      "GET /propostas",
      "POST /propostas",
      "POST /propostas/:id/decidir",
      "GET /eventos",
      "POST /eventos",
      "GET /eventos/stream",
      ...(deps.marketplaces
        ? [
            "GET /nichos",
            "POST /nichos",
            "POST /coleta/buscar",
            "POST /monitor/rodar",
            "GET /precos/historico",
            "GET /ofertas",
            "POST /ofertas",
          ]
        : []),
    ],
    pendentes: FERRAMENTAS_PENDENTES.map((f) => ({ rota: `${f.metodo} ${f.rota}`, motivo: f.motivo })),
  }));

  return app;
}
