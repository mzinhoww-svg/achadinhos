import { getZonedParts, wallToUtc } from "@achadinhos/domain";

export type SendStatus = "queued" | "sending" | "sent" | "failed" | "skipped";

/** Linha de Envios como a UI recebe: sem ids internos de mensagem nem `account_id`. */
export interface PublicSend {
  id: string;
  status: SendStatus;
  reason: string | null;
  /** "Manual" ou o nome da automação. */
  origin: string;
  offerTitle: string | null;
  groupName: string | null;
  /** Horário relevante em ISO UTC: envio efetivo ou agendado. */
  at: string;
  shortLink: string | null;
}

export interface DayCounts {
  sent: number;
  queued: number;
  failed: number;
  skipped: number;
}

export const FINAL: ReadonlySet<SendStatus> = new Set(["sent", "failed", "skipped"]);

/** Início e fim (UTC) do dia local da conta que contém `now`. */
export function dayWindow(now: Date, timeZone: string): { start: Date; end: Date } {
  const p = getZonedParts(now, timeZone);
  const start = wallToUtc(p.year, p.month, p.day, 0, 0, 0, timeZone);
  const next = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
  const end = wallToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0, 0, timeZone);
  return { start, end };
}

/** Cards do dia: enviados/falhas/ignorados são do dia local; "na fila" é o agora (inclui `sending`). */
export function countDay(items: readonly Pick<PublicSend, "status" | "at">[], win: { start: Date; end: Date }): DayCounts {
  const c: DayCounts = { sent: 0, queued: 0, failed: 0, skipped: 0 };
  for (const i of items) {
    if (i.status === "queued" || i.status === "sending") {
      c.queued++;
      continue;
    }
    const t = Date.parse(i.at);
    if (t >= win.start.getTime() && t < win.end.getTime()) c[i.status]++;
  }
  return c;
}
