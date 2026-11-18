import { z } from "zod";

export const registrarEvento = z.object({
  /** Ex.: "oferta.criada", "checagem.reprovada", "biblia.atualizada". */
  tipo: z
    .string()
    .trim()
    .regex(/^[a-z0-9_]+(\.[a-z0-9_]+)*$/, "use minúsculas separadas por ponto")
    .max(80),
  agente: z.string().trim().min(1).max(80),
  dados: z.record(z.string(), z.unknown()).default({}),
  ofertaId: z.number().int().positive().optional(),
});
export type RegistrarEvento = z.infer<typeof registrarEvento>;

export const evento = z.object({
  id: z.number().int(),
  tipo: z.string(),
  agente: z.string(),
  dados: z.record(z.string(), z.unknown()),
  ofertaId: z.number().int().nullable(),
  criadoEm: z.string(),
});
export type Evento = z.infer<typeof evento>;

/** Canal do LISTEN/NOTIFY: o payload é só o id do evento, para caber no limite de 8000 bytes. */
export const CANAL_EVENTOS = "achadinhos_eventos";
