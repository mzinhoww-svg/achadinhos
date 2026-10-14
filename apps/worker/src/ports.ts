import type { ProductOfferV2Result } from "@achadinhos/shopee";
import type { OfferFilters } from "@achadinhos/domain";

export type ProductOfferNode = ProductOfferV2Result["productOfferV2"]["nodes"][number];

export type AutomationRow = {
  id: string;
  accountId: string;
  status: "active" | "paused" | "archived";
  /** 0 = domingo … 6 = sábado, no fuso da conta */
  days: number[];
  windowStart: string;
  windowEnd: string;
  frequencyMin: 15 | 30 | 60;
  filters: OfferFilters;
  /** IANA (accounts.timezone). Nunca offset fixo (decisão 001 A7). */
  timezone: string;
};

export type DueGroup = {
  automationId: string;
  groupId: string;
  accountId: string;
  channelId: string;
  nextRunAt: Date | null;
  automation: AutomationRow;
};

export type SendHistoryRow = {
  itemId: string | null;
  status: "queued" | "sending" | "sent" | "failed" | "skipped";
  reason: string | null;
  sentAt: Date | null;
  attemptedAt: Date | null;
  createdAt: Date;
};

export type NewSend = {
  accountId: string;
  automationId: string;
  groupId: string;
  channelId: string;
  offerId: string | null;
  status: "queued" | "skipped";
  reason: string | null;
  idempotencyKey: string;
  scheduledFor: Date;
};

/**
 * Operações dentro de UMA transação. A implementação Postgres usa:
 *  - lockGroup: `select … from automation_groups join automations … where
 *    automation_id=$1 and group_id=$2 and (next_run_at is null or next_run_at <= $3)
 *    for update of automation_groups skip locked`
 *  - insertSend: `insert … on conflict (account_id, idempotency_key) do nothing`
 *  - hasOpenSend: queued/sending cujo idempotency_key começa com `automationId:groupId:`
 *    (sends não tem automation_id; a chave carrega a automação).
 */
export interface SchedulerTx {
  lockGroup(automationId: string, groupId: string, now: Date): Promise<DueGroup | null>;
  hasOpenSend(automationId: string, groupId: string): Promise<boolean>;
  upsertOffer(accountId: string, offer: ProductOfferNode): Promise<{ id: string }>;
  /** false quando a chave de slot já existia (nada inserido). */
  insertSend(send: NewSend): Promise<boolean>;
  setNextRunAt(automationId: string, groupId: string, next: Date): Promise<void>;
}

export interface SchedulerStore {
  /** Leitura sem lock: candidatos vencidos (next_run_at nulo ou <= now), automação ativa, grupo ativo. */
  listDueGroups(now: Date, limit: number): Promise<DueGroup[]>;
  listRecentSends(groupId: string, since: Date): Promise<SendHistoryRow[]>;
  hasOpenSend(automationId: string, groupId: string): Promise<boolean>;
  transaction<T>(fn: (tx: SchedulerTx) => Promise<T>): Promise<T>;
}

export type SelectionInput = {
  accountId: string;
  automationId: string;
  groupId: string;
  filters: OfferFilters;
  history: SendHistoryRow[];
  now: Date;
  dedupeDays: number;
};

export type SelectionResult =
  | { kind: "offer"; offer: ProductOfferNode }
  | { kind: "none"; reason: "sem_oferta" | "repetida" };

export type OfferSelector = (input: SelectionInput) => Promise<SelectionResult>;
