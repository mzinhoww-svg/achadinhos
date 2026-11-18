import type { Db } from "@achadinhos/db";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { registrarEvento } from "../servicos.js";
import { type Armazenamento, lerArquivo } from "./armazenamento.js";
import { escolherLote, listarImagens, renderizar } from "./servico.js";

export interface DepsArte {
  armazenamento: Armazenamento;
  limiarConfianca: number;
  publicUrl?: string | undefined;
  f?: typeof fetch;
}

const formato = z.enum(["quadrado", "retrato", "ambos"]).default("ambos");
const formatos = (f: "quadrado" | "retrato" | "ambos") =>
  f === "ambos" ? (["quadrado", "retrato"] as const).slice() : [f];

export function rotasArte(app: FastifyInstance, db: Db, deps: DepsArte) {
  const baseUrl = (req: FastifyRequest) => deps.publicUrl ?? `${req.protocol}://${req.host}`;
  const opcoes = (req: FastifyRequest) => ({
    armazenamento: deps.armazenamento,
    baseUrl: baseUrl(req),
    limiarConfianca: deps.limiarConfianca,
    ...(deps.f ? { f: deps.f } : {}),
  });

  /** T3.1: renderiza a peça de uma oferta (ou a prévia de um produto). */
  app.post("/imagem/render", async (req, reply) => {
    const b = z
      .object({
        ofertaId: z.number().int().positive().optional(),
        produtoId: z.number().int().positive().optional(),
        formato,
        forcarFallback: z.boolean().default(false),
        agente: z.string().trim().min(1).max(80).optional(),
      })
      .refine((x) => Boolean(x.ofertaId) !== Boolean(x.produtoId), "informe ofertaId ou produtoId (só um)")
      .parse(req.body);
    const r = await renderizar(
      db,
      {
        ...(b.ofertaId ? { ofertaId: b.ofertaId } : {}),
        ...(b.produtoId ? { produtoId: b.produtoId } : {}),
        formatos: formatos(b.formato),
        forcarFallback: b.forcarFallback,
        ...(b.agente ? { agente: b.agente } : {}),
      },
      opcoes(req),
    );
    return reply.code(201).send(r);
  });

  /**
   * Conferência: renderiza um lote do nicho em segundo plano (202) e responde na hora com o que entrou.
   * `forcarFallbackEm` força o fallback em N peças do lote, para conferir esse caminho.
   */
  app.post("/imagem/lote", async (req, reply) => {
    const b = z
      .object({
        nichoId: z.number().int().positive().optional(),
        limite: z.number().int().min(1).max(20).default(10),
        formato,
        forcarFallbackEm: z.number().int().min(0).max(20).default(0),
      })
      .parse(req.body ?? {});
    const itens = await escolherLote(db, b.nichoId, b.limite);
    const o = opcoes(req);
    void (async () => {
      let ok = 0;
      let falhas = 0;
      for (const [i, item] of itens.entries()) {
        try {
          await renderizar(
            db,
            {
              ...item,
              formatos: formatos(b.formato),
              forcarFallback: i >= itens.length - b.forcarFallbackEm,
            },
            o,
          );
          ok++;
        } catch (e) {
          falhas++;
          req.log.warn({ err: e, item }, "peça do lote falhou");
          await registrarEvento(db, {
            tipo: "arte.erro",
            agente: "Diretor de Arte",
            ...("ofertaId" in item && item.ofertaId ? { ofertaId: item.ofertaId } : {}),
            dados: { ...item, mensagem: (e as Error).message.slice(0, 300) },
          }).catch(() => {});
        }
      }
      await registrarEvento(db, {
        tipo: "arte.lote_concluido",
        agente: "Diretor de Arte",
        dados: { pedidos: itens.length, ok, falhas },
      }).catch(() => {});
    })();
    return reply.code(202).send({ pedidos: itens.length, itens });
  });

  app.get("/imagens", async (req) => {
    const q = z
      .object({
        ofertaId: z.coerce.number().int().positive().optional(),
        produtoId: z.coerce.number().int().positive().optional(),
        limite: z.coerce.number().int().min(1).max(100).default(30),
      })
      .parse(req.query);
    return { armazenamento: deps.armazenamento.nome, renderizacoes: await listarImagens(db, q) };
  });

  /** Público: peças guardadas no banco (reserva do Blob). O caminho tem um id aleatório. */
  app.get("/arquivos/*", async (req, reply) => {
    const caminho = (req.params as { "*": string })["*"];
    if (!/^[\w./-]{1,200}$/.test(caminho) || caminho.includes("..")) return reply.code(404).send();
    const a = await lerArquivo(db, caminho);
    if (!a) return reply.code(404).send({ erro: "nao_encontrado" });
    return reply
      .header("content-type", a.tipo)
      .header("cache-control", "public, max-age=31536000, immutable")
      .send(a.dados);
  });
}
