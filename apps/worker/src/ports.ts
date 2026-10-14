/**
 * Portas da fila de envios (decisão 001). Quem implementa (fila SQL, T7-02/T7-03)
 * deve passar a suíte `tests/contract/queue-contract.ts` sem alterações.
 * Todo "agora" vem do banco; o relógio do worker não participa.
 */
export type SendStatus = "queued" | "sending" | "sent" | "failed" | "skipped";

export const LEASE_EXPIRED_REASON = "lease_expirado_resultado_desconhecido";
export const OUTSIDE_WINDOW_REASON = "fora_da_janela";

export interface ClaimedSend {
  id: string;
  channelId: string;
  leaseExpiresAt: Date;
}

export interface FinishInput {
  status: "sent" | "failed" | "skipped";
  reason?: string;
  externalMessageId?: string;
}

export interface QueuePort {
  /** Atômico: no máximo um `sending` por canal; respeita 60 s, teto diário e reaper. */
  claimNextSend(channelId: string): Promise<ClaimedSend | null>;
  /**
   * Conclui um send em `sending`. Retorna `false` (sem efeito) se o lease já foi
   * reapado ou o send não está em `sending`: resultado tardio nunca ressuscita.
   */
  finishSend(id: string, input: FinishInput): Promise<boolean>;
}
