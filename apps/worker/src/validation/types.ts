/**
 * T7-08 — validação de credenciais pelo worker (decisão 003 H1).
 * O painel grava o segredo no Vault e marca `pending_validation`; o worker lê
 * o Vault, valida e grava `validated`/`invalid` + `last_error` saneado.
 */

export type ValidationStatus = "pending_validation" | "validated" | "invalid";

export type ValidationTask =
  | {
      kind: "shopee_credential";
      id: string;
      accountId: string;
      appId: string;
      secretId: string;
      attempts: number;
    }
  | {
      kind: "telegram_channel";
      id: string;
      accountId: string;
      secretId: string;
      attempts: number;
    }
  | {
      kind: "telegram_group";
      id: string;
      accountId: string;
      channelId: string;
      /** Secret do token do canal dono do grupo. */
      secretId: string;
      /** chat_id do Telegram. */
      externalId: string;
      attempts: number;
    };

/**
 * Porta de persistência. O adaptador SQL deve:
 * - `claimPending`: selecionar `status = 'pending_validation'` com
 *   `FOR UPDATE SKIP LOCKED` e lease curto (2 workers não pegam a mesma tarefa);
 * - gravar datas com o `now()` do banco/UTC (o `Date` recebido é do worker).
 */
export interface ValidationStore {
  claimPending(limit: number): Promise<ValidationTask[]>;
  markValidated(task: ValidationTask, at: Date): Promise<void>;
  /** `lastError` já saneado (texto fixo, nunca derivado da resposta externa). */
  markInvalid(task: ValidationTask, lastError: string, at: Date): Promise<void>;
  /** Falha transitória: volta a `pending_validation`, attempts + 1. */
  release(task: ValidationTask, lastError: string, at: Date): Promise<void>;
}

/** Leitura do Vault (service role/role dedicada do worker). Nunca logar o retorno. */
export interface SecretVault {
  read(secretId: string): Promise<string | null>;
}

export interface ValidationLogger {
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
}

export type Outcome =
  | { status: "validated" }
  | { status: "invalid"; error: string }
  | { status: "retry"; error: string };
