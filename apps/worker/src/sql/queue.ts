import type { ClaimedSend, FinishInput, QueuePort } from "../ports.js";
import type { SqlClient } from "./client.js";

/** `FinishArgs` do executor e `FinishInput` da porta, com os campos que `finish_send` grava. */
export type PgFinishInput = FinishInput & {
  shortLink?: string;
  /** Caminho do objeto no bucket, nunca a URL assinada. */
  creativeUrl?: string;
  messageText?: string;
};

type ExecutorFinishArgs =
  | { status: "sent"; externalMessageId: string; shortLink: string; creativeUrl: string; messageText: string }
  | { status: "failed" | "skipped"; reason: string };

/**
 * Fila sobre as RPCs `claim_next_send`/`finish_send`/`reap_expired_sends` (T7-02/T7-03).
 * Toda regra (1 por canal, 60 s, teto, lease, reaper) mora no banco; o relógio é o do banco.
 * A conexão deve usar a role service_role (ou dedicada): EXECUTE é só dela.
 */
export class PgQueue implements QueuePort {
  constructor(private readonly db: SqlClient) {}

  async claimNextSend(channelId: string): Promise<ClaimedSend | null> {
    const r = await this.db.query<{ id: string; channel_id: string; lease_expires_at: Date }>(
      "select id, channel_id, lease_expires_at from public.claim_next_send($1::uuid)",
      [channelId],
    );
    const row = r.rows[0];
    return row ? { id: row.id, channelId: row.channel_id, leaseExpiresAt: row.lease_expires_at } : null;
  }

  async finishSend(id: string, input: PgFinishInput): Promise<boolean> {
    const r = await this.db.query<{ ok: boolean }>(
      "select public.finish_send($1::uuid, $2, $3, $4, $5, $6, $7) as ok",
      [
        id,
        input.status,
        input.reason ?? null,
        input.externalMessageId ?? null,
        input.shortLink ?? null,
        input.creativeUrl ?? null,
        input.messageText ?? null,
      ],
    );
    return r.rows[0]?.ok === true;
  }

  /** Assinatura de `ExecutorDeps.finish`. */
  finish = (sendId: string, args: ExecutorFinishArgs | PgFinishInput): Promise<boolean> =>
    this.finishSend(sendId, args as PgFinishInput);

  /** Reaper explícito (o claim já reapa o próprio canal). Sem canal: todos. */
  async reapExpired(channelId?: string): Promise<number> {
    const r = await this.db.query<{ n: number }>("select public.reap_expired_sends($1::uuid) as n", [channelId ?? null]);
    return Number(r.rows[0]?.n ?? 0);
  }
}
