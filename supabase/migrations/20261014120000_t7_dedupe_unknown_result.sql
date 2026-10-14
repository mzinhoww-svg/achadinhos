-- Farol B2 (#13): o executor grava vários motivos de "resultado desconhecido"
-- (telegram_timeout_, telegram_transporte_, telegram_resposta_invalida_ ...), todos
-- terminando em `_resultado_desconhecido` (UNKNOWN_RESULT_SUFFIX em apps/worker).
-- O índice de dedupe passa a reconhecer o sufixo, não só o motivo do reaper.
DROP INDEX public.sends_dedupe_idx;
CREATE INDEX sends_dedupe_idx
  ON public.sends (group_id, offer_id, attempted_at)
  WHERE status = 'sent'
     OR (status = 'failed' AND reason LIKE '%\_resultado\_desconhecido');
