import { z } from "zod";
import { slugBiblia } from "./biblia.ts";

export const STATUS_PROPOSTA = ["aberta", "aprovada", "rejeitada"] as const;
export type StatusProposta = (typeof STATUS_PROPOSTA)[number];

export const criarProposta = z.object({
  titulo: z.string().trim().min(1).max(200),
  descricao: z.string().trim().min(1).max(5_000),
  autor: z.string().trim().min(1).max(80),
  /** Quando a proposta muda um documento da bíblia: o slug e o texto completo proposto. */
  docSlug: slugBiblia.optional(),
  conteudoProposto: z.string().min(1).max(200_000).optional(),
});
export type CriarProposta = z.infer<typeof criarProposta>;

export const decidirProposta = z.object({
  decisao: z.enum(["aprovada", "rejeitada"]),
  /** Só o Coordenador ou o Aurimar decidem (pacote/PROMPT_INSTALACAO.md). */
  decididoPor: z.string().trim().min(1).max(80),
  comentario: z.string().trim().max(2_000).optional(),
});
export type DecidirProposta = z.infer<typeof decidirProposta>;

export const proposta = z.object({
  id: z.number().int(),
  titulo: z.string(),
  descricao: z.string(),
  autor: z.string(),
  docSlug: z.string().nullable(),
  conteudoProposto: z.string().nullable(),
  status: z.enum(STATUS_PROPOSTA),
  decididoPor: z.string().nullable(),
  comentario: z.string().nullable(),
  criadoEm: z.string(),
  decididoEm: z.string().nullable(),
});
export type Proposta = z.infer<typeof proposta>;
