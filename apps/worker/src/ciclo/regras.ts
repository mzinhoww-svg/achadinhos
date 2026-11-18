import type { Db } from "@achadinhos/db";
import { z } from "zod";
import { lerDoc } from "../servicos.js";

/**
 * Regras do ciclo lidas da bíblia. Cada documento pode ter um bloco ```json com os campos abaixo; o que faltar
 * usa o padrão, que segue a bíblia v1.0 do Coordenador (envio 8h/11h/14h/17h/20h, até 3 extras acima de 40%,
 * no máximo 8 por dia, 20 min entre mensagens, teto de US$ 1 por dia e US$ 20 por mês, banimento pausa tudo).
 */

const hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const regrasEnvio = z.object({
  horarios: z.array(hora).min(1).default(["08:00", "11:00", "14:00", "17:00", "20:00"]),
  maxPorDia: z.number().int().min(1).max(50).default(8),
  intervaloMinMin: z.number().int().min(1).max(240).default(20),
  extras: z
    .object({
      max: z.number().int().min(0).max(10).default(3),
      descontoMinPct: z.number().min(1).max(95).default(40),
    })
    .prefault({}),
  formato: z.enum(["quadrado", "retrato"]).default("retrato"),
  pausarEmBanimento: z.boolean().default(true),
  tetoDiarioUsd: z.number().min(0).default(1),
  tetoMensalUsd: z.number().min(0).default(20),
  falhasSeguidasParaPausar: z.number().int().min(1).max(20).default(3),
  reprovacaoMaxPct: z.number().min(1).max(100).default(20),
  reprovacaoMinAmostras: z.number().int().min(1).default(5),
  janelaPrecoMin: z.number().int().min(0).default(10),
});
export type RegrasEnvio = z.infer<typeof regrasEnvio>;

export const regrasChecagem = z.object({
  diasSemRepetir: z.number().int().min(0).max(90).default(7),
  marcasBloqueadas: z.array(z.string()).default([]),
  palavrasBloqueadas: z.array(z.string()).default([]),
  nichosBloqueados: z.array(z.string()).default([]),
  /** Peça no fallback abaixo desta confiança é reprovada (o fallback com foto boa passa). */
  fallbackConfiancaMin: z.number().min(0).max(1).default(0.2),
  /** Tolerância de preço (R$) entre o banco e o preço atual do marketplace. */
  toleranciaPreco: z.number().min(0).default(0.01),
});
export type RegrasChecagem = z.infer<typeof regrasChecagem>;

export const tomDeVoz = z.object({
  identificacoes: z.array(z.string().min(2)).min(1).default(["#publi", "publicidade", "link de afiliado"]),
  identificacaoPadrao: z.string().default("#publi · link de afiliado"),
  maxCaracteres: z.number().int().min(100).max(2000).default(600),
  exemplos: z.array(z.string()).default([]),
});
export type TomDeVoz = z.infer<typeof tomDeVoz>;

const modeloTarefa = z.object({ principal: z.string().min(3), reserva: z.string().min(3).optional() });
export const modelosAgentes = z.object({
  copy: modeloTarefa.default({
    principal: "openai/gpt-4o-mini",
    reserva: "meta-llama/llama-3.3-70b-instruct",
  }),
  coordenador: modeloTarefa.default({ principal: "openai/gpt-4o", reserva: "openai/gpt-4o-mini" }),
});
export type ModelosAgentes = z.infer<typeof modelosAgentes>;

export function blocoJson(conteudo: string | null | undefined): unknown {
  const bloco = conteudo ? /```json\s*\n([\s\S]*?)```/.exec(conteudo)?.[1] : undefined;
  if (!bloco) return {};
  try {
    return JSON.parse(bloco);
  } catch {
    return {};
  }
}

async function ler<T>(db: Db, slug: string, esquema: z.ZodType<T>, chave?: string): Promise<T> {
  const doc = await lerDoc(db, slug);
  let json = blocoJson(doc?.conteudo) as Record<string, unknown>;
  if (chave && json && typeof json === "object" && chave in json)
    json = json[chave] as Record<string, unknown>;
  const r = esquema.safeParse(json ?? {});
  return r.success ? r.data : esquema.parse({});
}

export const lerRegrasEnvio = (db: Db) => ler(db, "REGRAS-DE-ENVIO", regrasEnvio);
export const lerRegrasChecagem = (db: Db) => ler(db, "CHECAGEM", regrasChecagem);
export const lerTomDeVoz = async (db: Db) => {
  const t = await ler(db, "TOM-DE-VOZ", tomDeVoz);
  const doc = await lerDoc(db, "TOM-DE-VOZ");
  return {
    ...t,
    texto:
      doc?.conteudo
        .replace(/```json[\s\S]*?```/g, "")
        .trim()
        .slice(0, 4000) ?? "",
  };
};
export const lerModelos = (db: Db) => ler(db, "AGENTES", modelosAgentes, "modelos");
