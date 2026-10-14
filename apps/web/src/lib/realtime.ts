import { sanitizeText } from "@/server/sanitize";
import { FINAL, type PublicSend, type SendStatus } from "./envios-view";

/** Mudança de um envio, já reduzida aos campos que a UI pode usar. */
export interface SendChange {
  id: string;
  accountId: string;
  status: SendStatus;
  reason: string | null;
  sentAt: string | null;
}

const STATUSES: readonly SendStatus[] = ["queued", "sending", "sent", "failed", "skipped"];
const isStatus = (v: unknown): v is SendStatus => typeof v === "string" && (STATUSES as readonly string[]).includes(v);

/**
 * Aplica um evento à lista. Defesa em profundidade: o RLS já impede eventos de outra conta no Realtime; aqui
 * ignoramos qualquer coisa que não seja da conta da sessão e nunca regredimos um estado final.
 */
export function applySendChange(items: readonly PublicSend[], c: SendChange, accountId: string): { items: PublicSend[]; refresh: boolean } {
  if (c.accountId !== accountId) return { items: [...items], refresh: false };
  const i = items.findIndex((x) => x.id === c.id);
  if (i < 0) return { items: [...items], refresh: true };
  const cur = items[i]!;
  if (FINAL.has(cur.status)) return { items: [...items], refresh: false };
  const next: PublicSend = {
    ...cur,
    status: c.status,
    reason: c.reason === null ? null : sanitizeText(c.reason).slice(0, 300),
    at: c.sentAt ?? cur.at,
  };
  return { items: items.map((x, k) => (k === i ? next : x)), refresh: false };
}

export type ConnectionState = "live" | "reconnecting";

/** O polling só descansa enquanto a assinatura Realtime está ao vivo; em qualquer outro estado a tela relê sozinha. */
export function shouldPoll(conn: ConnectionState | "polling"): boolean {
  return conn !== "live";
}

/** Superfície mínima de `@supabase/supabase-js` usada aqui (tipagem estrutural: a web não depende do SDK ainda). */
export interface RealtimeChannelLike {
  on(type: "postgres_changes", filter: { event: string; schema: string; table: string; filter?: string }, cb: (payload: unknown) => void): RealtimeChannelLike;
  subscribe(cb?: (status: string) => void): RealtimeChannelLike;
}
export interface RealtimeClientLike {
  channel(name: string): RealtimeChannelLike;
  removeChannel(ch: RealtimeChannelLike): unknown;
}

function toChange(payload: unknown, accountId: string): SendChange | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as { eventType?: unknown; new?: unknown };
  if (p.eventType !== "INSERT" && p.eventType !== "UPDATE") return null;
  const r = p.new;
  if (!r || typeof r !== "object") return null;
  const row = r as Record<string, unknown>;
  if (typeof row.id !== "string" || row.account_id !== accountId || !isStatus(row.status)) return null;
  return {
    id: row.id,
    accountId,
    status: row.status,
    reason: typeof row.reason === "string" ? row.reason : null,
    sentAt: typeof row.sent_at === "string" ? row.sent_at : null,
  };
}

/**
 * Assina `public.sends` filtrado pela conta. O Realtime aplica o RLS do JWT do usuário: o filtro é
 * redundante de propósito. Devolve a função que cancela a assinatura.
 */
export function subscribeSends(
  client: RealtimeClientLike,
  accountId: string,
  onChange: (c: SendChange) => void,
  onState?: (s: ConnectionState) => void,
): () => void {
  const channel = client
    .channel(`sends:${accountId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "sends", filter: `account_id=eq.${accountId}` }, (payload) => {
      const c = toChange(payload, accountId);
      if (c) onChange(c);
    })
    .subscribe((status) => onState?.(status === "SUBSCRIBED" ? "live" : "reconnecting"));
  return () => {
    void client.removeChannel(channel);
  };
}
