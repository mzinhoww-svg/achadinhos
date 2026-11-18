import { timingSafeEqual } from "node:crypto";
import { type Db, tabelas as t } from "@achadinhos/db";
import { and, desc, eq, gte } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ErroNegocio } from "../servicos.js";
import { checarOferta, listarChecagens } from "./checagem.js";
import { definirPausa, lerPausa } from "./controle.js";
import { gastoLlm, gerarCopy } from "./copy.js";
import {
  agendarAprovadas,
  agendarOferta,
  aoEventoGateway,
  type DepsCiclo,
  executarDevidos,
  prepararOferta,
  verificarAnomalias,
} from "./disparo.js";
import { criarOfertaEnsaio } from "./ensaio.js";
import { registrarClique } from "./links.js";

const idParam = z.object({ id: z.coerce.number().int().positive() });
const jidGrupo = z.string().regex(/^[0-9-]{5,40}@g\.us$/, "JID do grupo (…@g.us)");
const telefone = z.string().regex(/^\d{10,15}$/);

function tokenIgual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function rotasCiclo(app: FastifyInstance, d: DepsCiclo, webhookToken: string | undefined) {
  const { db } = d;
  const gateway = () => {
    if (!d.gateway)
      throw new ErroNegocio(
        503,
        "gateway_indisponivel",
        "WA_GATEWAY_URL e WA_GATEWAY_TOKEN não configurados",
      );
    return d.gateway;
  };

  // ---------- pausa ----------
  app.get("/pausa", async () => lerPausa(db));
  app.post("/pausa", async (req) => {
    const b = z
      .object({
        pausado: z.boolean(),
        motivo: z.string().trim().min(1).max(300).default("pedido manual"),
        autor: z.string().trim().min(1).max(80).default("Coordenador"),
      })
      .parse(req.body);
    return definirPausa(db, b.pausado, b.motivo, b.autor, d.alertas);
  });

  // ---------- copy, checagem, preparo ----------
  app.post("/ofertas/:id/copy", async (req) => {
    const { id } = idParam.parse(req.params);
    const { agente } = z
      .object({ agente: z.string().trim().min(1).max(80).default("Copywriter") })
      .parse(req.body ?? {});
    return gerarCopy(
      db,
      id,
      {
        openrouterKey: d.openrouterKey,
        openrouterBaseUrl: d.openrouterBaseUrl,
        alertas: d.alertas,
        ...(d.fLlm ? { f: d.fLlm } : {}),
      },
      agente,
    );
  });

  app.post("/ofertas/:id/checar", async (req) => {
    const { id } = idParam.parse(req.params);
    const { agente } = z
      .object({ agente: z.string().trim().min(1).max(80).default("Checagem") })
      .parse(req.body ?? {});
    const r = await checarOferta(db, id, agente);
    await verificarAnomalias(d);
    // Aprovada segue direto para o disparo, sem ação de ninguém.
    const disparo = r.aprovada ? await agendarOferta(db, id, d.agora?.() ?? new Date()) : null;
    return { ...r, disparo };
  });

  app.post("/ofertas/:id/preparar", async (req) => {
    const { id } = idParam.parse(req.params);
    return prepararOferta(d, id, "Coordenador");
  });

  app.get("/checagens", async (req) => {
    const { limite } = z
      .object({ limite: z.coerce.number().int().min(1).max(200).default(50) })
      .parse(req.query);
    return { checagens: await listarChecagens(db, limite) };
  });

  // ---------- disparo ----------
  app.post("/disparo", async (req) => {
    const b = z
      .object({ ofertaId: z.number().int().positive().optional(), executar: z.boolean().default(false) })
      .parse(req.body ?? {});
    const agora = d.agora?.() ?? new Date();
    const agendamentos = b.ofertaId
      ? [await agendarOferta(db, b.ofertaId, agora)]
      : await agendarAprovadas(db, agora);
    const execucao = b.executar ? await executarDevidos(d) : null;
    return { agendamentos, execucao, pausa: await lerPausa(db) };
  });

  app.get("/envios", async (req) => {
    const q = z
      .object({
        status: z.enum(["agendado", "enviando", "enviado", "falhou", "cancelado"]).optional(),
        dias: z.coerce.number().int().min(1).max(90).default(7),
        limite: z.coerce.number().int().min(1).max(500).default(100),
      })
      .parse(req.query);
    const linhas = await db
      .select({
        id: t.envios.id,
        status: t.envios.status,
        agendadoPara: t.envios.agendadoPara,
        enviadoEm: t.envios.enviadoEm,
        extra: t.envios.extra,
        erro: t.envios.erro,
        numero: t.envios.numeroGateway,
        ofertaId: t.envios.ofertaId,
        grupo: t.grupos.nome,
        grupoId: t.grupos.id,
        produto: t.produtos.nome,
        ensaio: t.ofertas.ensaio,
        imagemUrl: t.envios.imagemUrl,
        texto: t.envios.texto,
      })
      .from(t.envios)
      .innerJoin(t.ofertas, eq(t.ofertas.id, t.envios.ofertaId))
      .innerJoin(t.produtos, eq(t.produtos.id, t.ofertas.produtoId))
      .innerJoin(t.grupos, eq(t.grupos.id, t.envios.grupoId))
      .where(
        and(
          q.status ? eq(t.envios.status, q.status) : undefined,
          gte(t.envios.criadoEm, new Date(Date.now() - q.dias * 86_400_000)),
        ),
      )
      .orderBy(desc(t.envios.agendadoPara))
      .limit(q.limite);
    return { envios: linhas };
  });

  app.get("/travas", async () => ({
    pausa: await lerPausa(db),
    gastoLlmUsd: await gastoLlm(db),
    reprovacao: await verificarAnomalias(d),
  }));

  // ---------- link curto (o painel chama ao receber /r/:codigo) ----------
  app.post("/links/:codigo/clique", async (req, reply) => {
    const { codigo } = z.object({ codigo: z.string().regex(/^[A-Za-z0-9]{4,16}$/) }).parse(req.params);
    const b = z
      .object({
        ipHash: z.string().max(64).nullable().optional(),
        userAgent: z.string().max(500).nullable().optional(),
      })
      .parse(req.body ?? {});
    const r = await registrarClique(db, codigo, b.ipHash ?? null, b.userAgent ?? null);
    return r ?? reply.code(404).send({ erro: "nao_encontrado" });
  });

  // ---------- grupos ----------
  app.get("/grupos", async () => {
    const grupos = await db.select().from(t.grupos).orderBy(t.grupos.id);
    const nichos = await db.select().from(t.grupoNichos);
    return {
      grupos: grupos.map((g) => ({
        ...g,
        nichoIds: nichos.filter((n) => n.grupoId === g.id).map((n) => n.nichoId),
      })),
    };
  });

  app.post("/grupos", async (req, reply) => {
    const b = z
      .object({
        id: z.number().int().positive().optional(),
        nome: z.string().trim().min(2).max(120),
        waJid: jidGrupo.nullable().optional(),
        promessa: z.string().max(300).nullable().optional(),
        teste: z.boolean().default(false),
        ativo: z.boolean().default(true),
        maxPorDia: z.number().int().min(1).max(50).nullable().optional(),
        horarios: z
          .array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/))
          .max(24)
          .default([]),
        nichoIds: z.array(z.number().int().positive()).default([]),
        autor: z.string().trim().min(1).max(80).default("Coordenador"),
      })
      .parse(req.body);
    const valores = {
      nome: b.nome,
      waJid: b.waJid ?? null,
      promessa: b.promessa ?? null,
      teste: b.teste,
      ativo: b.ativo,
      maxPorDia: b.maxPorDia ?? null,
      horarios: b.horarios,
    };
    const [g] = b.id
      ? await db.update(t.grupos).set(valores).where(eq(t.grupos.id, b.id)).returning()
      : await db.insert(t.grupos).values(valores).returning();
    if (!g) throw new ErroNegocio(404, "nao_encontrado", "grupo não existe");
    await db.delete(t.grupoNichos).where(eq(t.grupoNichos.grupoId, g.id));
    if (b.nichoIds.length)
      await db.insert(t.grupoNichos).values(b.nichoIds.map((nichoId) => ({ grupoId: g.id, nichoId })));
    await db.insert(t.auditoria).values({
      ator: b.autor,
      acao: b.id ? "grupo.alterado" : "grupo.criado",
      alvo: `grupo:${g.id}`,
      detalhes: valores,
    });
    let gatewayOk: boolean | string = false;
    if (g.waJid && d.gateway) {
      gatewayOk = await d.gateway
        .salvarGrupo(g.waJid, { nome: g.nome })
        .then(() => true)
        .catch((e: Error) => e.message);
    }
    return reply.code(b.id ? 200 : 201).send({ ...g, nichoIds: b.nichoIds, gateway: gatewayOk });
  });

  // ---------- números (pool do wa-gateway) ----------
  app.get("/numeros", async () => gateway().numeros());

  app.post("/numeros", async (req, reply) => {
    const b = z
      .object({
        instanceId: z.string().regex(/^[a-z0-9-]{2,32}$/),
        ordem: z.number().int().min(0).max(99).default(0),
      })
      .parse(req.body);
    const r = await gateway().adicionarNumero(b.instanceId, b.ordem);
    return reply.code(201).send({
      instanceId: b.instanceId,
      pareamento: { url: `/parear/${r.pareamento.token}`, expiraEm: r.pareamento.expiraEm },
    });
  });

  app.post("/numeros/:instanceId/pareamento", async (req) => {
    const { instanceId } = z.object({ instanceId: z.string().regex(/^[a-z0-9-]{2,32}$/) }).parse(req.params);
    return gateway().pareamento(instanceId);
  });

  app.post("/numeros/:instanceId/promover", async (req) => {
    const { instanceId } = z.object({ instanceId: z.string().regex(/^[a-z0-9-]{2,32}$/) }).parse(req.params);
    return gateway().promover(instanceId);
  });

  /** Números pessoais do dono: recebem alertas e mandam PAUSAR/RETOMAR; nunca conectam no gateway. */
  app.post("/wa/pool", async (req) => {
    const b = z.object({ adminPhones: z.array(telefone).min(1).max(5) }).parse(req.body);
    return gateway().configurarPool(b.adminPhones);
  });

  app.post("/grupos/:id/entrada", async (req) => {
    const { id } = idParam.parse(req.params);
    const b = z
      .object({
        chave: z.string().regex(/^[a-z0-9-]{2,40}$/),
        mensagem: z.string().min(8).max(200),
        origem: z.string().min(1).max(80),
      })
      .parse(req.body);
    const [g] = await db.select().from(t.grupos).where(eq(t.grupos.id, id));
    if (!g?.waJid) throw new ErroNegocio(422, "grupo_sem_jid", "cadastre o JID do grupo antes");
    const r = await gateway().salvarEntrada({
      chave: b.chave,
      grupoJid: g.waJid,
      mensagem: b.mensagem,
      origem: b.origem,
    });
    if (r.waLink) await db.update(t.grupos).set({ linkEntrada: r.waLink }).where(eq(t.grupos.id, id));
    return r;
  });

  // ---------- ensaio ----------
  app.post("/ensaio/oferta", async (req, reply) => {
    const b = z
      .object({
        nichoId: z.number().int().positive().optional(),
        descontoPct: z.number().min(5).max(80).optional(),
        defeito: z.enum(["preco"]).nullable().optional(),
        preparar: z.boolean().default(true),
      })
      .parse(req.body ?? {});
    const e = await criarOfertaEnsaio(db, {
      ...(b.nichoId ? { nichoId: b.nichoId } : {}),
      ...(b.descontoPct ? { descontoPct: b.descontoPct } : {}),
      defeito: b.defeito ?? null,
    });
    const preparo = b.preparar ? await prepararOferta(d, e.ofertaId, "ensaio") : null;
    return reply.code(201).send({ ...e, preparo });
  });

  // ---------- webhook do wa-gateway (público, com token na URL) ----------
  app.post("/wa/webhook", async (req, reply) => {
    const { t: token } = z.object({ t: z.string().optional() }).parse(req.query);
    if (!webhookToken || !token || !tokenIgual(token, webhookToken))
      return reply.code(401).send({ erro: "nao_autorizado" });
    const e = z
      .object({ type: z.string().min(1).max(80) })
      .passthrough()
      .parse(req.body);
    return aoEventoGateway(d, e);
  });
}
