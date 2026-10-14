import "server-only";
import { z } from "zod";
import { countDay, dayWindow, type DayCounts, type PublicSend, type SendStatus } from "@/lib/envios-view";
import { publicError } from "./connections";
import type { SendRecord, SendsRepo } from "./envios-ports";
import type { Session } from "./session";

export const WINDOW_DAYS = 30;
export const MAX_ROWS = 200;
const DAY_MS = 86_400_000;

export interface EnviosDeps {
  sends: SendsRepo;
  now?: () => Date;
}

const STATUS_VALUES = ["all", "queued", "sending", "sent", "failed", "skipped"] as const;
export type StatusFilter = (typeof STATUS_VALUES)[number];

const filterSchema = z.object({
  status: z.enum(STATUS_VALUES).catch("all"),
  groupId: z.string().min(1).max(64).nullable().catch(null),
});

export interface EnviosView {
  today: DayCounts;
  items: PublicSend[];
  filter: { status: StatusFilter; groupId: string | null };
  /** `true` quando havia mais que `MAX_ROWS` no período. */
  truncated: boolean;
  /** Fuso da conta e dia local em ISO (UTC) — o cliente recalcula os cards ao receber eventos. */
  timeZone: string;
  dayStart: string;
  dayEnd: string;
}

function toPublic(r: SendRecord): PublicSend {
  return {
    id: r.id,
    status: r.status,
    reason: publicError(r.reason),
    origin: r.priority >= 100 || !r.automationName ? "Manual" : r.automationName,
    offerTitle: r.offerTitle === null ? null : r.offerTitle.slice(0, 200),
    groupName: r.groupName,
    at: (r.sentAt ?? r.scheduledFor).toISOString(),
    shortLink: r.shortLink,
  };
}

/** Filtros vêm da URL (não confiável): valor inválido cai no padrão, nunca vira erro 500 nem consulta ampla. */
export async function getEnvios(deps: EnviosDeps, session: Session, rawFilter: unknown): Promise<EnviosView> {
  const now = deps.now?.() ?? new Date();
  const raw = rawFilter && typeof rawFilter === "object" ? (rawFilter as Record<string, unknown>) : {};
  const filter = filterSchema.parse({ status: raw.status ?? "all", groupId: raw.groupId ?? null });
  const tz = await deps.sends.timezone(session.accountId);
  const win = dayWindow(now, tz);
  const since = new Date(now.getTime() - WINDOW_DAYS * DAY_MS);
  const recs = (await deps.sends.list(session.accountId, since)).filter(
    // o repo traz também fila antiga; a lista é só da janela de 30 dias
    (r) => r.status === "queued" || r.status === "sending" || (r.sentAt ?? r.scheduledFor).getTime() >= since.getTime(),
  );
  const all = recs.map(toPublic).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  // Cards sempre sobre o total da conta; a lista respeita os filtros.
  const today = countDay(all, win);
  const wanted = (r: SendRecord) =>
    (filter.status === "all" || r.status === filter.status || (filter.status === "queued" && r.status === "sending")) &&
    (!filter.groupId || r.groupId === filter.groupId);
  const filtered = recs.filter(wanted).map(toPublic).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return {
    today,
    items: filtered.slice(0, MAX_ROWS),
    filter,
    truncated: filtered.length > MAX_ROWS,
    timeZone: tz,
    dayStart: win.start.toISOString(),
    dayEnd: win.end.toISOString(),
  };
}

export type { SendStatus };
