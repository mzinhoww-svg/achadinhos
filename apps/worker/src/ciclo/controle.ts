import { type Db, tabelas as t } from "@achadinhos/db";
import { eq } from "drizzle-orm";
import { registrarEvento } from "../servicos.js";
import type { Gateway } from "./gateway.js";

export interface EstadoPausa {
  pausado: boolean;
  motivo: string | null;
  por: string | null;
  em: string | null;
}

export async function lerControle<T extends Record<string, unknown>>(
  db: Db,
  chave: string,
): Promise<T | null> {
  const [l] = await db.select().from(t.controle).where(eq(t.controle.chave, chave));
  return (l?.valor as T) ?? null;
}

export async function gravarControle(db: Db, chave: string, valor: Record<string, unknown>) {
  await db
    .insert(t.controle)
    .values({ chave, valor, atualizadoEm: new Date() })
    .onConflictDoUpdate({ target: t.controle.chave, set: { valor, atualizadoEm: new Date() } });
}

export async function lerPausa(db: Db): Promise<EstadoPausa> {
  const v = await lerControle<Partial<EstadoPausa>>(db, "pausa");
  return { pausado: Boolean(v?.pausado), motivo: v?.motivo ?? null, por: v?.por ?? null, em: v?.em ?? null };
}

/** PAUSAR para tudo na hora: o disparo confere a pausa antes de cada envio. */
export async function definirPausa(
  db: Db,
  pausar: boolean,
  motivo: string,
  por: string,
  alerta?: Alertas,
): Promise<EstadoPausa> {
  const antes = await lerPausa(db);
  const estado: EstadoPausa = {
    pausado: pausar,
    motivo: pausar ? motivo : null,
    por,
    em: new Date().toISOString(),
  };
  await gravarControle(db, "pausa", { ...estado });
  if (antes.pausado !== pausar) {
    await registrarEvento(db, {
      tipo: pausar ? "sistema.pausado" : "sistema.retomado",
      agente: por,
      dados: { motivo },
    });
    await db
      .insert(t.auditoria)
      .values({ ator: por, acao: pausar ? "pausa" : "retomada", alvo: "sistema", detalhes: { motivo } });
    await alerta?.enviar(
      pausar ? `⏸️ Achadinhos PAUSADO (${por}): ${motivo}` : `▶️ Achadinhos retomado (${por}).`,
    );
  }
  return estado;
}

/** Alertas no privado do dono, pelo wa-gateway. Sem gateway configurado, ficam só no log. */
export class Alertas {
  constructor(
    private db: Db,
    private gateway: Gateway | null,
  ) {}

  async enviar(texto: string, ref?: string) {
    await registrarEvento(this.db, {
      tipo: "alerta",
      agente: "worker",
      dados: { texto: texto.slice(0, 1000) },
    });
    if (!this.gateway) return { enviado: false, motivo: "gateway não configurado" };
    try {
      await this.gateway.privado(texto, ref);
      return { enviado: true, motivo: null };
    } catch (e) {
      await registrarEvento(this.db, {
        tipo: "alerta.falhou",
        agente: "worker",
        dados: { erro: (e as Error).message.slice(0, 300) },
      });
      return { enviado: false, motivo: (e as Error).message };
    }
  }

  /** Um aviso por chave por dia (ex.: teto de gasto), para não encher o privado. */
  async umaVezPorDia(chave: string, texto: string) {
    const hoje = new Date().toISOString().slice(0, 10);
    const ja = await lerControle<{ dia?: string }>(this.db, `aviso:${chave}`);
    if (ja?.dia === hoje) return;
    await gravarControle(this.db, `aviso:${chave}`, { dia: hoje });
    await this.enviar(texto);
  }
}
