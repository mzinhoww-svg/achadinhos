/** Porta de leitura do T8-07. No banco é `select` com colunas explícitas em `sends` (+ joins) sob RLS. */
export type SendStatusValue = "queued" | "sending" | "sent" | "failed" | "skipped";

export interface SendRecord {
  id: string;
  status: SendStatusValue;
  reason: string | null;
  priority: number;
  /** Nulo quando o grupo foi removido. */
  groupId: string | null;
  /** `scheduled_for` (UTC). */
  scheduledFor: Date;
  sentAt: Date | null;
  /** Nulos quando a oferta/grupo foi removido (FK `set null`; histórico permanece). */
  offerTitle: string | null;
  groupName: string | null;
  automationName: string | null;
  shortLink: string | null;
}

export interface SendsRepo {
  /** Envios da conta com `coalesce(sent_at, scheduled_for) >= since`, ou ainda em andamento (queued/sending). */
  list(accountId: string, since: Date): Promise<SendRecord[]>;
  /** `accounts.timezone` (IANA). */
  timezone(accountId: string): Promise<string>;
}
