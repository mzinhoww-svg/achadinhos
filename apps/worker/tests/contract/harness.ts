import type { QueuePort, SendStatus } from "../../src/ports.js";

export interface SendRow {
  id: string;
  channelId: string;
  status: SendStatus;
  reason: string | null;
  priority: number;
  attemptedAt: Date | null;
}

/** O que a suíte precisa de uma implementação (em memória hoje, SQL depois). */
export interface QueueHarness {
  /** Cada worker é um cliente independente da mesma fila. */
  newWorker(): QueuePort;
  enqueue(opts: { channelId: string; priority?: number }): Promise<string>;
  /** Insere histórico já tentado (conta no teto diário), em `at` (UTC). */
  seedAttempted(channelId: string, count: number, at: Date): Promise<void>;
  /** Move o relógio do BANCO. */
  setDbNow(at: Date): Promise<void>;
  dbNow(): Date;
  get(id: string): Promise<SendRow>;
  /** Fuso da conta dona do canal (IANA). */
  setTimezone(tz: string): Promise<void>;
}

export type HarnessFactory = () => Promise<QueueHarness> | QueueHarness;
