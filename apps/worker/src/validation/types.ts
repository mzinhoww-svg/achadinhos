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
      /** Já postamos a verificação neste grupo? Se sim, nunca postar de novo. */
      verificationSentAt?: Date | null;
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
  /**
   * `lastError` já saneado (texto fixo, nunca derivado da resposta externa).
   * `clearVerification`: falha definitiva da API (nada foi entregue), então
   * `verification_sent_at` volta a nulo e uma nova validação pode postar.
   * Sem a opção a marca é mantida (entrega possível: timeout/transporte).
   *
   * Contrato do painel: pedir nova validação = status `pending_validation`,
   * `attempts = 0`, `verification_sent_at = NULL`, `last_error = NULL`.
   */
  markInvalid(
    task: ValidationTask,
    lastError: string,
    at: Date,
    options?: { clearVerification?: boolean },
  ): Promise<void>;
  /**
   * Falha transitória: volta a `pending_validation`, attempts + 1.
   * `clearVerification`: o envio da verificação foi recusado sem entrega
   * (ex.: 429), então `verification_sent_at` volta a nulo e o reenvio é seguro.
   */
  release(
    task: ValidationTask,
    lastError: string,
    at: Date,
    options?: { clearVerification?: boolean },
  ): Promise<void>;
  /**
   * Grava `verification_sent_at` ANTES de postar no grupo (grupo real, visível
   * a outros membros). Resultado desconhecido depois disso nunca reposta.
   */
  markVerificationSent(task: ValidationTask, at: Date): Promise<void>;
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
  | { status: "invalid"; error: string; clearVerification?: true }
  | { status: "retry"; error: string }
  /** Recusado sem entrega (429): pode reenviar a verificação com segurança. */
  | { status: "retry"; error: string; clearVerification: true };
