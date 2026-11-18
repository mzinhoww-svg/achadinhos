import type { Db } from "@achadinhos/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ErroNegocio } from "../servicos.js";
import type { Marketplaces } from "./marketplaces.js";
import type { RegrasOferta } from "./regras.js";
import {
  coletarNicho,
  detectarOferta,
  historicoPrecos,
  listarNichos,
  listarOfertas,
  listarProdutos,
  rodarMonitor,
  salvarNicho,
} from "./servico.js";

const nichoEntrada = z.object({
  nome: z.string().trim().min(2).max(80),
  palavras: z.array(z.string().trim().min(2).max(80)).min(1).max(30),
  precoMin: z.number().nonnegative().nullable().optional(),
  precoMax: z.number().positive().nullable().optional(),
  descontoMinPct: z.number().min(1).max(90).optional(),
  avaliacaoMin: z.number().min(0).max(5).optional(),
  vendasMin: z.number().int().min(0).optional(),
  ativo: z.boolean().optional(),
  marketplace: z.enum(["shopee", "mercadolivre", "fake"]).optional(),
  template: z.string().trim().max(80).nullable().optional(),
  modeloLlm: z.string().trim().max(120).nullable().optional(),
  autor: z.string().trim().min(1).max(80).default("Coordenador"),
});

export function rotasColeta(app: FastifyInstance, db: Db, mk: Marketplaces, regras: RegrasOferta) {
  const principal = () => {
    if (!mk.principal)
      throw new ErroNegocio(503, "marketplace_indisponivel", mk.indisponivel ?? "marketplace indisponível");
    return mk.principal;
  };

  app.get("/nichos", async () => ({ nichos: await listarNichos(db) }));

  app.post("/nichos", async (req, reply) => {
    const e = nichoEntrada.parse(req.body);
    if (e.marketplace === "mercadolivre") {
      return reply.code(501).send({ erro: "nao_implementado", motivo: "Mercado Livre entra na fase 2." });
    }
    if (e.precoMin != null && e.precoMax != null && e.precoMin > e.precoMax) {
      throw new ErroNegocio(400, "entrada_invalida", "precoMin maior que precoMax");
    }
    const { autor, ...nicho } = e;
    return reply.code(201).send(await salvarNicho(db, nicho, autor));
  });

  /** T2.2: roda as palavras-chave do nicho no marketplace, normaliza e grava (dedupe por marketplace + id). */
  app.post("/coleta/buscar", async (req) => {
    const b = z
      .object({
        nichoId: z.number().int().positive().optional(),
        nicho: z.string().trim().min(2).max(80).optional(),
        paginas: z.number().int().min(1).max(5).default(1),
        limite: z.number().int().min(1).max(50).default(50),
        agente: z.string().trim().min(1).max(80).default("Garimpeiro"),
      })
      .refine((x) => x.nichoId || x.nicho, "informe nichoId ou nicho")
      .parse(req.body);
    return coletarNicho(
      db,
      principal(),
      { ...(b.nichoId ? { nichoId: b.nichoId } : {}), ...(b.nicho ? { nome: b.nicho } : {}) },
      {
        paginas: b.paginas,
        limite: b.limite,
        agente: b.agente,
      },
    );
  });

  /** T2.3 sob demanda (o job roda sozinho a cada 2 h). */
  app.post("/monitor/rodar", async (req) => {
    const b = z.object({ maxDetalhes: z.number().int().min(0).max(2000).optional() }).parse(req.body ?? {});
    return rodarMonitor(db, principal(), {
      regras,
      ...(b.maxDetalhes !== undefined ? { maxDetalhes: b.maxDetalhes } : {}),
    });
  });

  app.get("/produtos", async (req) => {
    const q = z
      .object({
        nichoId: z.coerce.number().int().positive().optional(),
        limite: z.coerce.number().int().min(1).max(200).default(50),
        pagina: z.coerce.number().int().min(1).default(1),
      })
      .parse(req.query);
    return listarProdutos(db, q);
  });

  app.get("/precos/historico", async (req) => {
    const q = z
      .object({
        produtoId: z.coerce.number().int().positive(),
        dias: z.coerce.number().int().min(1).max(90).default(30),
      })
      .parse(req.query);
    return historicoPrecos(db, q.produtoId, q.dias);
  });

  app.get("/ofertas", async (req) => {
    const q = z
      .object({
        status: z
          .enum(["candidata", "aprovada", "reprovada", "agendada", "enviada", "expirada", "cancelada"])
          .optional(),
        nichoId: z.coerce.number().int().positive().optional(),
        limite: z.coerce.number().int().min(1).max(200).default(50),
      })
      .parse(req.query);
    return { ofertas: await listarOfertas(db, q) };
  });

  /** Monitor pede a avaliação de um produto; só cria a candidata se a regra de oferta real passar. */
  app.post("/ofertas", async (req, reply) => {
    const b = z
      .object({
        produtoId: z.number().int().positive(),
        agente: z.string().trim().min(1).max(80).default("Monitor"),
      })
      .parse(req.body);
    const r = await detectarOferta(db, b.produtoId, regras, b.agente);
    if (r.criada) return reply.code(201).send(r);
    if (r.motivo === "oferta_ja_aberta") return reply.code(409).send({ erro: "oferta_ja_aberta", ...r });
    return reply.code(422).send({ erro: "nao_e_oferta", ...r });
  });
}
