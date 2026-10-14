/**
 * Falha cujo resultado é desconhecido (a mensagem pode ter saído): bloqueia repetição no dedupe.
 * Fonte única do sufixo: executor (grava), seleção de ofertas (lê) e índice `sends_dedupe_idx`
 * (`LIKE '%\_resultado\_desconhecido'`) usam o mesmo valor.
 */
export const UNKNOWN_RESULT_SUFFIX = "_resultado_desconhecido";

export function isUnknownResultReason(reason: unknown): boolean {
  return (
    typeof reason === "string" &&
    reason.length > UNKNOWN_RESULT_SUFFIX.length &&
    reason.endsWith(UNKNOWN_RESULT_SUFFIX)
  );
}
