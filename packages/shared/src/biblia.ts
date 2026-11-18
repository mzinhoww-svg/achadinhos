import { z } from "zod";

/** Os 11 documentos da bíblia, na ordem de pacote/PROMPT_INSTALACAO.md. */
export const DOCS_BIBLIA = [
  "BIBLIA",
  "AGENTES",
  "NICHOS",
  "TOM-DE-VOZ",
  "REGRAS-DE-OFERTA",
  "REGRAS-DE-ENVIO",
  "TEMPLATES-VISUAIS",
  "CHECAGEM",
  "FAILOVER",
  "ROTINA",
  "METRICAS",
] as const;
export type SlugBiblia = (typeof DOCS_BIBLIA)[number];

/** Slug do documento: letras maiúsculas, números e hífen (ex.: TOM-DE-VOZ). Aceita "TOM-DE-VOZ.md". */
export const slugBiblia = z
  .string()
  .trim()
  .transform((s) => s.replace(/\.md$/i, "").toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9][A-Z0-9-]{0,63}$/, "slug inválido"));

export const gravarDocBiblia = z.object({
  slug: slugBiblia,
  titulo: z.string().trim().min(1).max(200).optional(),
  conteudo: z.string().min(1).max(200_000),
  autor: z.string().trim().min(1).max(80),
  motivo: z.string().trim().max(500).optional(),
});
export type GravarDocBiblia = z.infer<typeof gravarDocBiblia>;

export const docBiblia = z.object({
  slug: z.string(),
  versao: z.number().int().positive(),
  titulo: z.string(),
  conteudo: z.string(),
  autor: z.string(),
  motivo: z.string().nullable(),
  criadoEm: z.string(),
});
export type DocBiblia = z.infer<typeof docBiblia>;

export const resumoDocBiblia = docBiblia.omit({ conteudo: true }).extend({ tamanho: z.number().int() });
export type ResumoDocBiblia = z.infer<typeof resumoDocBiblia>;
