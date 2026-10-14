-- T7-03: finish_send. M2: enqueue_send_now ("Mandar agora").
CREATE EXTENSION IF NOT EXISTS pgtap;

BEGIN;
SELECT no_plan();

INSERT INTO auth.users (id, aud, role, email) VALUES
  ('11111111-1111-1111-1111-111111111111','authenticated','authenticated','u1@t.com'),
  ('22222222-2222-2222-2222-222222222222','authenticated','authenticated','u2@t.com');
INSERT INTO public.accounts (account_id, user_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','22222222-2222-2222-2222-222222222222');
INSERT INTO public.channels (id, account_id, kind, config_secret_id) VALUES
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','telegram', vault.create_secret('ca')),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','telegram', vault.create_secret('cb'));
INSERT INTO public.groups (id, account_id, channel_id, external_id, sub_id, active) VALUES
  ('ffffffff-ffff-ffff-ffff-ffffffffffff','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','ext-a1','ga1', true),
  ('f3f3f3f3-f3f3-f3f3-f3f3-f3f3f3f3f3f3','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','ext-a3','ga3', false),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','cccccccc-cccc-cccc-cccc-cccccccccccc','ext-b1','gb1', true);
INSERT INTO public.offers (id, account_id, item_id) VALUES
  ('77777777-7777-7777-7777-777777777771','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','i1'),
  ('77777777-7777-7777-7777-777777777772','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','i2'),
  ('77777777-7777-7777-7777-777777777779','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','ib');

-- sends em vários estados (inseridos como dono)
CREATE FUNCTION pg_temp.mk(p_id uuid, p_offer uuid, p_status text DEFAULT 'queued') RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.sends (id, account_id, offer_id, group_id, channel_id, idempotency_key, status,
                            attempted_at, lease_expires_at, finished_at)
  VALUES (p_id, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', p_offer, 'ffffffff-ffff-ffff-ffff-ffffffffffff',
          'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'k-' || p_id::text, p_status,
          CASE WHEN p_status IN ('sending','sent','failed') THEN now() END,
          CASE WHEN p_status = 'sending' THEN now() + interval '120 seconds' END,
          CASE WHEN p_status IN ('sent','failed','skipped') THEN now() END);
$$;

-- ---------- finish_send: sent ----------
SELECT pg_temp.mk('51000000-0000-0000-0000-000000000001','77777777-7777-7777-7777-777777777771','sending');
SELECT is(public.finish_send('51000000-0000-0000-0000-000000000001','sent', NULL, 'tg-123',
            'https://shope.ee/x', 'https://cdn.example/c.png', 'Oferta!'),
  true, 'finish_send(sent) devolve true');
SELECT is(
  (SELECT concat_ws('|', status, external_message_id, short_link, creative_url, message_text,
                    sent_at IS NOT NULL, finished_at IS NOT NULL)
     FROM public.sends WHERE id='51000000-0000-0000-0000-000000000001'),
  'sent|tg-123|https://shope.ee/x|https://cdn.example/c.png|Oferta!|t|t',
  'sent grava id da mensagem, link, criativo, texto, sent_at e finished_at');
SELECT is(public.finish_send('51000000-0000-0000-0000-000000000001','failed','x'), false,
  'segunda finalização é no-op (false)');
SELECT is((SELECT status FROM public.sends WHERE id='51000000-0000-0000-0000-000000000001'), 'sent',
  'estado terminal não muda');
SELECT is((SELECT count(*)::int FROM public.send_status_events
            WHERE send_id='51000000-0000-0000-0000-000000000001' AND new_status='sent'), 1,
  'a transição gerou 1 evento');

-- ---------- failed / skipped ----------
SELECT pg_temp.mk('51000000-0000-0000-0000-000000000002','77777777-7777-7777-7777-777777777772','sending');
SELECT is(public.finish_send('51000000-0000-0000-0000-000000000002','failed','telegram_400'), true, 'failed com motivo');
SELECT is((SELECT reason FROM public.sends WHERE id='51000000-0000-0000-0000-000000000002'), 'telegram_400', 'motivo gravado');
SELECT is((SELECT sent_at FROM public.sends WHERE id='51000000-0000-0000-0000-000000000002'), NULL::timestamptz,
  'failed não preenche sent_at');

-- reason é limitado (vai para a UI)
SELECT pg_temp.mk('51000000-0000-0000-0000-000000000003', NULL, 'sending');
SELECT is(public.finish_send('51000000-0000-0000-0000-000000000003','failed', repeat('x', 5000)), true, 'failed com motivo enorme');
SELECT is((SELECT length(reason) FROM public.sends WHERE id='51000000-0000-0000-0000-000000000003'), 500, 'reason truncado em 500');

-- queued -> skipped (fora_da_janela) é aceito e não vira tentativa
SELECT pg_temp.mk('51000000-0000-0000-0000-000000000004', NULL, 'queued');
SELECT is(public.finish_send('51000000-0000-0000-0000-000000000004','skipped','fora_da_janela'), true, 'queued -> skipped');
SELECT is((SELECT attempted_at FROM public.sends WHERE id='51000000-0000-0000-0000-000000000004'), NULL::timestamptz,
  'skipped de fila não gera attempted_at (não gasta cota)');
-- queued -> sent/failed NÃO
SELECT pg_temp.mk('51000000-0000-0000-0000-000000000005', NULL, 'queued');
SELECT is(public.finish_send('51000000-0000-0000-0000-000000000005','sent', NULL, 'm'), false, 'queued -> sent recusado (false)');
SELECT is(public.finish_send('51000000-0000-0000-0000-000000000005','failed','r'), false, 'queued -> failed recusado (false)');
SELECT is((SELECT status FROM public.sends WHERE id='51000000-0000-0000-0000-000000000005'), 'queued', 'segue queued');

-- ---------- validações de argumento ----------
SELECT pg_temp.mk('51000000-0000-0000-0000-000000000006', NULL, 'sending');
SELECT throws_ok($$SELECT public.finish_send('51000000-0000-0000-0000-000000000006','queued','x')$$,
  '22023', NULL, 'status inválido');
SELECT throws_ok($$SELECT public.finish_send('51000000-0000-0000-0000-000000000006','sending','x')$$,
  '22023', NULL, 'não finaliza para sending');
SELECT throws_ok($$SELECT public.finish_send('51000000-0000-0000-0000-000000000006','sent')$$,
  '22023', NULL, 'sent exige external_message_id');
SELECT throws_ok($$SELECT public.finish_send('51000000-0000-0000-0000-000000000006','failed','  ')$$,
  '22023', NULL, 'failed exige motivo');
SELECT throws_ok($$SELECT public.finish_send('51000000-0000-0000-0000-000000000006','skipped')$$,
  '22023', NULL, 'skipped exige motivo');
SELECT is((SELECT status FROM public.sends WHERE id='51000000-0000-0000-0000-000000000006'), 'sending',
  'argumento inválido não altera a linha');
SELECT is(public.finish_send('00000000-0000-0000-0000-00000000dead','failed','x'), false, 'id inexistente => false');
SELECT is(public.finish_send('51000000-0000-0000-0000-000000000006','failed','fim'), true, 'libera o canal para os próximos casos');

-- ---------- crash: lease perdido para o reaper (T7-03) ----------
SELECT pg_temp.mk('51000000-0000-0000-0000-000000000007','77777777-7777-7777-7777-777777777771','sending');
UPDATE public.sends SET lease_expires_at = now() - interval '1 second' WHERE id='51000000-0000-0000-0000-000000000007';
SELECT is(public.reap_expired_sends('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'), 1, 'reaper pega o lease vencido');
SELECT is(public.finish_send('51000000-0000-0000-0000-000000000007','sent', NULL, 'tg-late'), false,
  'worker que volta tarde recebe false (lease perdido)');
SELECT is((SELECT status || '/' || reason FROM public.sends WHERE id='51000000-0000-0000-0000-000000000007'),
  'failed/lease_expirado_resultado_desconhecido', 'a linha fica failed com resultado desconhecido (at-most-once)');
SELECT ok(EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'sends_dedupe_idx'
                    AND position('resultado' in indexdef) > 0
                    AND position('desconhecido' in indexdef) > 0
                    AND position('lease_expirado' in indexdef) = 0),
  'o índice de dedupe cobre esse caso e os motivos do executor (A5)');

-- lease vencido mas ainda não reapado: o worker consegue finalizar
SELECT pg_temp.mk('51000000-0000-0000-0000-000000000008','77777777-7777-7777-7777-777777777772','sending');
UPDATE public.sends SET lease_expires_at = now() - interval '1 second' WHERE id='51000000-0000-0000-0000-000000000008';
SELECT is(public.finish_send('51000000-0000-0000-0000-000000000008','sent', NULL, 'tg-ok'), true,
  'sem reaper no meio, finalizar com lease vencido ainda vale');

-- ---------- enqueue_send_now ----------
SELECT set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111', true);
SET LOCAL ROLE authenticated;

CREATE TEMP TABLE r (n int, id uuid);
GRANT ALL ON r TO authenticated;
INSERT INTO r SELECT 1, public.enqueue_send_now('ffffffff-ffff-ffff-ffff-ffffffffffff','77777777-7777-7777-7777-777777777772');
SELECT isnt((SELECT id FROM r WHERE n=1), NULL::uuid, 'enqueue_send_now devolve o id do send');
RESET ROLE;

SELECT is(
  (SELECT concat_ws('|', status, priority, account_id, group_id, channel_id, offer_id, scheduled_for IS NOT NULL)
     FROM public.sends WHERE id = (SELECT id FROM r WHERE n=1)),
  'queued|100|aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa|ffffffff-ffff-ffff-ffff-ffffffffffff|'
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee|77777777-7777-7777-7777-777777777772|t',
  'send nasce queued, prioridade 100, canal derivado do grupo');

-- duplo clique = 1 envio
SELECT set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111', true);
SET LOCAL ROLE authenticated;
INSERT INTO r SELECT 2, public.enqueue_send_now('ffffffff-ffff-ffff-ffff-ffffffffffff','77777777-7777-7777-7777-777777777772');
RESET ROLE;
SELECT is((SELECT id FROM r WHERE n=2), (SELECT id FROM r WHERE n=1), 'duplo clique devolve o mesmo send');
SELECT is((SELECT count(*)::int FROM public.sends
            WHERE group_id='ffffffff-ffff-ffff-ffff-ffffffffffff' AND offer_id='77777777-7777-7777-7777-777777777772'
              AND status='queued'), 1, 'e há uma única linha em fila');

-- posse
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.enqueue_send_now('dddddddd-dddd-dddd-dddd-dddddddddddd','77777777-7777-7777-7777-777777777779')$$,
  '42501', NULL, 'grupo de outra conta é recusado');
SELECT throws_ok(
  $$SELECT public.enqueue_send_now('ffffffff-ffff-ffff-ffff-ffffffffffff','77777777-7777-7777-7777-777777777779')$$,
  '42501', NULL, 'oferta de outra conta é recusada');
SELECT throws_ok(
  $$SELECT public.enqueue_send_now('00000000-0000-0000-0000-00000000dead','77777777-7777-7777-7777-777777777771')$$,
  '42501', NULL, 'grupo inexistente = mesma resposta de "não é seu"');
SELECT throws_ok(
  $$SELECT public.enqueue_send_now('f3f3f3f3-f3f3-f3f3-f3f3-f3f3f3f3f3f3','77777777-7777-7777-7777-777777777771')$$,
  '23514', NULL, 'grupo inativo é recusado');
-- cliente não consegue fabricar status/prioridade: não há caminho de INSERT
SELECT throws_ok(
  $$INSERT INTO public.sends (account_id, group_id, channel_id, idempotency_key, status, priority)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','ffffffff-ffff-ffff-ffff-ffffffffffff',
            'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','forjada','sent',100)$$,
  '42501', NULL, 'INSERT direto com status/priority forjados é recusado');
RESET ROLE;

-- anon e service_role não chamam; sem sessão não há auth.uid()
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$SELECT public.enqueue_send_now('ffffffff-ffff-ffff-ffff-ffffffffffff','77777777-7777-7777-7777-777777777771')$$,
  '42501', NULL, 'anon não chama enqueue_send_now');
RESET ROLE;
SELECT ok(NOT has_function_privilege('service_role','public.enqueue_send_now(uuid,uuid)','EXECUTE'),
  'service_role não tem enqueue_send_now (usa a fila direto)');
SELECT ok(has_function_privilege('authenticated','public.enqueue_send_now(uuid,uuid)','EXECUTE'),
  'authenticated executa enqueue_send_now');

-- o send enfileirado é reivindicado pela prioridade, respeitando 1-por-canal
SELECT is((SELECT id FROM queue_internal.claim_next_send_at('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', now() + interval '2 minutes')),
  (SELECT id FROM r WHERE n=1), '"mandar agora" é o próximo do claim');

SELECT * FROM finish();
ROLLBACK;
