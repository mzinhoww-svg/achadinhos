import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  type DepsReels,
  listarReels,
  marcarReel,
  pendentesDeVideo,
  planejarReels,
  receberVideo,
  reelDeFotos,
} from "./servico.js";

const idParam = z.object({ id: z.coerce.number().int().positive() });

export function rotasReels(app: FastifyInstance, d: DepsReels) {
  // Vídeo bruto (mp4) vindo do coletor no Mac: até 80 MB.
  app.addContentTypeParser(
    ["video/mp4", "application/octet-stream"],
    { parseAs: "buffer", bodyLimit: 80 * 1024 * 1024 },
    (_req, corpo, feito) => feito(null, corpo),
  );

  app.post("/reels/planejar", async (req) => {
    const b = z.object({ quantidade: z.number().int().min(1).max(50).default(40) }).parse(req.body ?? {});
    return planejarReels(d, {
      quantidade: b.quantidade,
      agente: (req.headers["x-agente"] as string | undefined) ?? "Diretor de Vídeo",
    });
  });

  app.get("/reels", async (req) => {
    const q = z
      .object({
        dia: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        status: z.enum(["video_pendente", "pronto", "agendado", "publicado", "falhou"]).optional(),
        limite: z.coerce.number().int().min(1).max(200).default(60),
      })
      .parse(req.query);
    return { reels: await listarReels(d.db, q) };
  });

  app.get("/reels/pendentes-video", async (req) => {
    const { limite } = z
      .object({ limite: z.coerce.number().int().min(1).max(60).default(40) })
      .parse(req.query);
    return { pendentes: await pendentesDeVideo(d.db, limite) };
  });

  app.post("/reels/:id/video", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const corpo = req.body;
    if (!Buffer.isBuffer(corpo) || corpo.length < 1000)
      return reply.code(400).send({ erro: "envie o mp4 no corpo (content-type video/mp4)" });
    return receberVideo(d, id, corpo);
  });

  app.post("/reels/:id/fotos", async (req) => {
    const { id } = idParam.parse(req.params);
    return reelDeFotos(d, id);
  });

  app.post("/reels/:id/status", async (req) => {
    const { id } = idParam.parse(req.params);
    const b = z
      .object({
        status: z.enum(["agendado", "publicado", "falhou"]),
        mlabsPostId: z.string().max(200).optional(),
        mlabsFlowId: z.string().max(200).optional(),
        agendadoPara: z.string().datetime({ offset: true }).optional(),
        erro: z.string().max(500).optional(),
      })
      .parse(req.body);
    return marcarReel(d.db, id, b, (req.headers["x-agente"] as string | undefined) ?? "Diretor de Vídeo");
  });
}
