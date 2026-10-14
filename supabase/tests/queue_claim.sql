-- T7-02/T7-03: claim_next_send, reaper e privilégios (decisão 001 A3, A4, A6, M3).
-- Relógio simulado via queue_internal.claim_next_send_at(canal, agora); a RPC pública usa now().
CREATE EXTENSION IF NOT EXISTS pgtap;

BEGIN;
SELECT no_plan();

-- Cuiabá = UTC-4. T0 = 11:00 locais de 2026-03-11.
CREATE FUNCTION pg_temp.t0() RETURNS timestamptz LANGUAGE sql AS $$ SELECT '2026-03-11 15:00:00+00'::timestamptz $$;

INSERT INTO auth.users (id, aud, role, email) VALUES
  ('11111111-1111-1111-1111-111111111111','authenticated','authenticated','u1@t.com');
INSERT INTO public.accounts (account_id, user_id, daily_cap_per_channel) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111', 200),
  ('cacacaca-caca-caca-caca-cacacacacaca','11111111-1111-1111-1111-111111111111', 2);

-- canal + grupo
CREATE FUNCTION pg_temp.mk_chan(p_acc uuid, p_chan uuid, p_grp uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.channels (id, account_id, kind, config_secret_id)
    VALUES (p_chan, p_acc, 'telegram', vault.create_secret('s-' || p_chan::text));
  INSERT INTO public.groups (id, account_id, channel_id, external_id, sub_id)
    VALUES (p_grp, p_acc, p_chan, 'ext-' || p_grp::text, 'sub-' || p_grp::text);
END $$;

-- send (com oferta própria, id = id do send)
CREATE FUNCTION pg_temp.mk_send(
  p_acc uuid, p_chan uuid, p_grp uuid, p_id uuid, p_prio integer, p_sched timestamptz,
  p_status text DEFAULT 'queued', p_attempted timestamptz DEFAULT NULL, p_finished timestamptz DEFAULT NULL,
  p_lease timestamptz DEFAULT NULL, p_reason text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.offers (id, account_id, item_id) VALUES (p_id, p_acc, 'item-' || p_id::text);
  INSERT INTO public.sends (id, account_id, offer_id, group_id, channel_id, idempotency_key, priority,
                            scheduled_for, status, attempted_at, finished_at, lease_expires_at, reason)
  VALUES (p_id, p_acc, p_id, p_grp, p_chan, 'k-' || p_id::text, p_prio, p_sched,
          p_status, p_attempted, p_finished, p_lease, p_reason);
END $$;

-- ids: A = conta 200/dia, C = conta com teto 2
-- canal 1 (fila principal)
SELECT pg_temp.mk_chan('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','c1000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001');
-- canal 2 (futuro), 3 (inativo), 4 (reaper), 5 (outro canal)
SELECT pg_temp.mk_chan('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','c2000000-0000-0000-0000-000000000002','92000000-0000-0000-0000-000000000002');
SELECT pg_temp.mk_chan('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','c3000000-0000-0000-0000-000000000003','93000000-0000-0000-0000-000000000003');
SELECT pg_temp.mk_chan('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','c4000000-0000-0000-0000-000000000004','94000000-0000-0000-0000-000000000004');
SELECT pg_temp.mk_chan('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','c5000000-0000-0000-0000-000000000005','95000000-0000-0000-0000-000000000005');
-- canais da conta com teto 2: 6 (teto), 7 (virada de dia: tentativas antes), 8 (virada: tentativas depois)
SELECT pg_temp.mk_chan('cacacaca-caca-caca-caca-cacacacacaca','c6000000-0000-0000-0000-000000000006','96000000-0000-0000-0000-000000000006');
SELECT pg_temp.mk_chan('cacacaca-caca-caca-caca-cacacacacaca','c7000000-0000-0000-0000-000000000007','97000000-0000-0000-0000-000000000007');
SELECT pg_temp.mk_chan('cacacaca-caca-caca-caca-cacacacacaca','c8000000-0000-0000-0000-000000000008','98000000-0000-0000-0000-000000000008');
UPDATE public.channels SET status='inactive' WHERE id='c3000000-0000-0000-0000-000000000003';

-- ---------- helpers de borda (M3) ----------
SELECT is(
  (SELECT day_start FROM queue_internal.local_day_bounds('America/Cuiaba','2026-03-11 03:59:30+00')),
  '2026-03-10 04:00:00+00'::timestamptz, 'Cuiabá 23:59:30 de 10/03 pertence ao dia que começa 04:00Z de 10/03');
SELECT is(
  (SELECT day_end FROM queue_internal.local_day_bounds('America/Cuiaba','2026-03-11 03:59:30+00')),
  '2026-03-11 04:00:00+00'::timestamptz, 'e termina 04:00Z de 11/03');
SELECT is(
  (SELECT day_start FROM queue_internal.local_day_bounds('America/Cuiaba','2026-03-11 04:00:30+00')),
  '2026-03-11 04:00:00+00'::timestamptz, 'Cuiabá 00:00:30 de 11/03 já é o dia novo');
SELECT is(
  (SELECT day_end FROM queue_internal.local_day_bounds('Asia/Tokyo','2026-03-11 14:59:59+00')),
  '2026-03-11 15:00:00+00'::timestamptz, 'outro fuso IANA (Tóquio UTC+9)');

-- ---------- fila vazia, canal inexistente, inativo ----------
SELECT is((SELECT count(*)::int FROM public.claim_next_send('c1000000-0000-0000-0000-000000000001')), 0,
  'fila vazia não devolve nada');
SELECT is((SELECT count(*)::int FROM public.claim_next_send('00000000-0000-0000-0000-00000000dead')), 0,
  'canal inexistente não devolve nada');

SELECT pg_temp.mk_send('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','c3000000-0000-0000-0000-000000000003','93000000-0000-0000-0000-000000000003',
  'b3000000-0000-0000-0000-000000000001', 0, pg_temp.t0() - interval '1 hour');
SELECT is((SELECT count(*)::int FROM queue_internal.claim_next_send_at('c3000000-0000-0000-0000-000000000003', pg_temp.t0())), 0,
  'canal inativo não é reivindicado');

-- ---------- prioridade, ordem, lease ----------
-- baixa antiga (t-20m), baixa recente (t-10m), alta (t-1m)
SELECT pg_temp.mk_send('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','c1000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001',
  'b1000000-0000-0000-0000-000000000001', 0, pg_temp.t0() - interval '20 minutes');
SELECT pg_temp.mk_send('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','c1000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001',
  'b1000000-0000-0000-0000-000000000002', 0, pg_temp.t0() - interval '10 minutes');
SELECT pg_temp.mk_send('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','c1000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001',
  'b1000000-0000-0000-0000-000000000003', 100, pg_temp.t0() - interval '1 minute');
-- futuro: nunca antes da hora
SELECT pg_temp.mk_send('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','c1000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001',
  'b1000000-0000-0000-0000-000000000004', 100, pg_temp.t0() + interval '1 hour');
-- de outro canal: nunca neste
SELECT pg_temp.mk_send('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','c5000000-0000-0000-0000-000000000005','95000000-0000-0000-0000-000000000005',
  'b5000000-0000-0000-0000-000000000001', 100, pg_temp.t0() - interval '1 hour');

SELECT is((SELECT id FROM queue_internal.claim_next_send_at('c1000000-0000-0000-0000-000000000001', pg_temp.t0())),
  'b1000000-0000-0000-0000-000000000003'::uuid, 'prioridade 100 sai primeiro (e ignora futuro / outro canal)');
SELECT is((SELECT status FROM public.sends WHERE id='b1000000-0000-0000-0000-000000000003'), 'sending', 'claim marca sending');
SELECT is((SELECT attempted_at FROM public.sends WHERE id='b1000000-0000-0000-0000-000000000003'),
  pg_temp.t0(), 'attempted_at = agora do banco');
SELECT is((SELECT lease_expires_at FROM public.sends WHERE id='b1000000-0000-0000-0000-000000000003'),
  pg_temp.t0() + interval '120 seconds', 'lease de 120 s (A4)');

-- 1 por canal: com envio vivo nada mais sai
SELECT is((SELECT count(*)::int FROM queue_internal.claim_next_send_at('c1000000-0000-0000-0000-000000000001', pg_temp.t0() + interval '5 minutes')
           WHERE false), 0, 'sanidade da forma da chamada');
SELECT is((SELECT count(*)::int FROM queue_internal.claim_next_send_at('c1000000-0000-0000-0000-000000000001', pg_temp.t0() + interval '30 seconds')), 0,
  'com sending vivo não há 2º claim no canal');

-- fim do envio em T0+10s => intervalo de 60 s conta do finished_at
UPDATE public.sends SET status='sent', finished_at = pg_temp.t0() + interval '10 seconds',
       sent_at = pg_temp.t0() + interval '10 seconds', external_message_id = 'm1'
 WHERE id='b1000000-0000-0000-0000-000000000003';

SELECT is((SELECT count(*)::int FROM queue_internal.claim_next_send_at('c1000000-0000-0000-0000-000000000001', pg_temp.t0() + interval '69 seconds')), 0,
  'dentro de 60 s do fim do envio anterior: nada');
SELECT is((SELECT id FROM queue_internal.claim_next_send_at('c1000000-0000-0000-0000-000000000001', pg_temp.t0() + interval '71 seconds')),
  'b1000000-0000-0000-0000-000000000001'::uuid, 'após 60 s: sai o mais antigo da mesma prioridade');

-- prioridade 100 não fura o intervalo
UPDATE public.sends SET status='failed', reason='erro_api', finished_at = pg_temp.t0() + interval '100 seconds'
 WHERE id='b1000000-0000-0000-0000-000000000001';
SELECT pg_temp.mk_send('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','c1000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001',
  'b1000000-0000-0000-0000-000000000009', 100, pg_temp.t0());
SELECT is((SELECT count(*)::int FROM queue_internal.claim_next_send_at('c1000000-0000-0000-0000-000000000001', pg_temp.t0() + interval '130 seconds')), 0,
  'prioridade 100 não fura o intervalo de 60 s');
SELECT is((SELECT id FROM queue_internal.claim_next_send_at('c1000000-0000-0000-0000-000000000001', pg_temp.t0() + interval '161 seconds')),
  'b1000000-0000-0000-0000-000000000009'::uuid, 'prioridade 100 sai assim que o intervalo permite');

-- ---------- futuro puro ----------
SELECT pg_temp.mk_send('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','c2000000-0000-0000-0000-000000000002','92000000-0000-0000-0000-000000000002',
  'b2000000-0000-0000-0000-000000000001', 0, pg_temp.t0() + interval '1 hour');
SELECT is((SELECT count(*)::int FROM queue_internal.claim_next_send_at('c2000000-0000-0000-0000-000000000002', pg_temp.t0())), 0,
  'scheduled_for no futuro não é reivindicado');
SELECT is((SELECT id FROM queue_internal.claim_next_send_at('c2000000-0000-0000-0000-000000000002', pg_temp.t0() + interval '61 minutes')),
  'b2000000-0000-0000-0000-000000000001'::uuid, 'e sai quando a hora chega');

-- ---------- reaper (A4) ----------
SELECT pg_temp.mk_send('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','c4000000-0000-0000-0000-000000000004','94000000-0000-0000-0000-000000000004',
  'b4000000-0000-0000-0000-000000000001', 0, pg_temp.t0() - interval '1 hour',
  'sending', pg_temp.t0() - interval '5 minutes', NULL, pg_temp.t0() - interval '3 minutes');
SELECT pg_temp.mk_send('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','c4000000-0000-0000-0000-000000000004','94000000-0000-0000-0000-000000000004',
  'b4000000-0000-0000-0000-000000000002', 0, pg_temp.t0() - interval '30 minutes');

SELECT is((SELECT count(*)::int FROM queue_internal.claim_next_send_at('c4000000-0000-0000-0000-000000000004', pg_temp.t0())), 0,
  'claim reapa o vencido e respeita o intervalo a partir do reaper');
SELECT is((SELECT status || '/' || reason FROM public.sends WHERE id='b4000000-0000-0000-0000-000000000001'),
  'failed/lease_expirado_resultado_desconhecido', 'crash após claim => failed com resultado desconhecido');
SELECT is((SELECT finished_at FROM public.sends WHERE id='b4000000-0000-0000-0000-000000000001'),
  pg_temp.t0(), 'reaper grava finished_at');
SELECT is((SELECT id FROM queue_internal.claim_next_send_at('c4000000-0000-0000-0000-000000000004', pg_temp.t0() + interval '61 seconds')),
  'b4000000-0000-0000-0000-000000000002'::uuid, 'depois do intervalo o próximo da fila sai');

-- lease ainda válido não é reapado
SELECT is((SELECT count(*)::int FROM queue_internal.reap_expired_at('c4000000-0000-0000-0000-000000000004'::uuid, pg_temp.t0() + interval '61 seconds') WHERE false), 0, 'forma');
SELECT is(queue_internal.reap_expired_at('c4000000-0000-0000-0000-000000000004', pg_temp.t0() + interval '61 seconds'), 0,
  'lease válido (T0+61s+120s) não é reapado');
SELECT is(queue_internal.reap_expired_at('c4000000-0000-0000-0000-000000000004', pg_temp.t0() + interval '5 minutes'), 1,
  'lease vencido é reapado');
SELECT is((SELECT status FROM public.sends WHERE id='b4000000-0000-0000-0000-000000000002'), 'failed', 'linha reapada ficou failed');

-- reaper público (todos os canais, sem relógio do chamador)
SELECT pg_temp.mk_send('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','c5000000-0000-0000-0000-000000000005','95000000-0000-0000-0000-000000000005',
  'b5000000-0000-0000-0000-000000000002', 0, pg_temp.t0() - interval '1 hour',
  'sending', now() - interval '10 minutes', NULL, now() - interval '8 minutes');
SELECT is(public.reap_expired_sends(),
  (SELECT count(*)::int FROM public.sends WHERE status = 'sending' AND lease_expires_at < now()),
  'reap_expired_sends() sem canal reapa em todos os canais pelo now() do banco');
SELECT is((SELECT status FROM public.sends WHERE id='b5000000-0000-0000-0000-000000000002'), 'failed',
  'o vencido do canal 5 foi reapado');
SELECT is(public.reap_expired_sends('c5000000-0000-0000-0000-000000000005'), 0, 'idempotente');

-- ---------- teto por canal/dia local (A6, M3) ----------
-- canal 6, teto 2: duas tentativas às 11:00 e 11:05 locais de 10/03 (15:00Z, 15:05Z)
SELECT pg_temp.mk_send('cacacaca-caca-caca-caca-cacacacacaca','c6000000-0000-0000-0000-000000000006','96000000-0000-0000-0000-000000000006',
  'b6000000-0000-0000-0000-000000000001', 0, '2026-03-10 14:00:00+00',
  'sent', '2026-03-10 15:00:00+00', '2026-03-10 15:00:05+00');
SELECT pg_temp.mk_send('cacacaca-caca-caca-caca-cacacacacaca','c6000000-0000-0000-0000-000000000006','96000000-0000-0000-0000-000000000006',
  'b6000000-0000-0000-0000-000000000002', 0, '2026-03-10 14:00:00+00',
  'failed', '2026-03-10 15:05:00+00', '2026-03-10 15:05:05+00', NULL, 'erro_api');
SELECT pg_temp.mk_send('cacacaca-caca-caca-caca-cacacacacaca','c6000000-0000-0000-0000-000000000006','96000000-0000-0000-0000-000000000006',
  'b6000000-0000-0000-0000-000000000003', 100, '2026-03-10 14:00:00+00');

-- 23:59:50 locais de 10/03 (03:59:50Z de 11/03): ainda é o dia das 2 tentativas
SELECT is((SELECT count(*)::int FROM queue_internal.claim_next_send_at('c6000000-0000-0000-0000-000000000006', '2026-03-11 03:59:50+00')), 0,
  'teto de 2 atingido às 23:59:50 de Cuiabá (UTC já é outro dia; o fuso local é que vale)');
-- 00:00:10 locais de 11/03: contador zerou
SELECT is((SELECT id FROM queue_internal.claim_next_send_at('c6000000-0000-0000-0000-000000000006', '2026-03-11 04:00:10+00')),
  'b6000000-0000-0000-0000-000000000003'::uuid, 'à 00:00:10 locais o teto reinicia');

-- canal 7: tentativas às 20:30 e 20:40 locais de 10/03 (00:30Z e 00:40Z de 11/03).
-- No UTC elas cairiam no "mesmo dia" de 04:00:10Z; no fuso local já é outro dia.
SELECT pg_temp.mk_send('cacacaca-caca-caca-caca-cacacacacaca','c7000000-0000-0000-0000-000000000007','97000000-0000-0000-0000-000000000007',
  'b7000000-0000-0000-0000-000000000001', 0, '2026-03-11 00:00:00+00',
  'sent', '2026-03-11 00:30:00+00', '2026-03-11 00:30:05+00');
SELECT pg_temp.mk_send('cacacaca-caca-caca-caca-cacacacacaca','c7000000-0000-0000-0000-000000000007','97000000-0000-0000-0000-000000000007',
  'b7000000-0000-0000-0000-000000000002', 0, '2026-03-11 00:00:00+00',
  'sent', '2026-03-11 00:40:00+00', '2026-03-11 00:40:05+00');
SELECT pg_temp.mk_send('cacacaca-caca-caca-caca-cacacacacaca','c7000000-0000-0000-0000-000000000007','97000000-0000-0000-0000-000000000007',
  'b7000000-0000-0000-0000-000000000003', 0, '2026-03-11 00:00:00+00');
SELECT is((SELECT id FROM queue_internal.claim_next_send_at('c7000000-0000-0000-0000-000000000007', '2026-03-11 04:00:10+00')),
  'b7000000-0000-0000-0000-000000000003'::uuid, 'tentativas do dia local anterior não contam no dia novo');

-- canal 8: sending conta para o teto (attempted_at) e o skipped nunca gasta cota
SELECT pg_temp.mk_send('cacacaca-caca-caca-caca-cacacacacaca','c8000000-0000-0000-0000-000000000008','98000000-0000-0000-0000-000000000008',
  'b8000000-0000-0000-0000-000000000001', 0, '2026-03-11 10:00:00+00',
  'skipped', NULL, '2026-03-11 10:00:00+00', NULL, 'fora_da_janela');
SELECT pg_temp.mk_send('cacacaca-caca-caca-caca-cacacacacaca','c8000000-0000-0000-0000-000000000008','98000000-0000-0000-0000-000000000008',
  'b8000000-0000-0000-0000-000000000002', 0, '2026-03-11 10:00:00+00',
  'sent', '2026-03-11 11:00:00+00', '2026-03-11 11:00:05+00');
SELECT pg_temp.mk_send('cacacaca-caca-caca-caca-cacacacacaca','c8000000-0000-0000-0000-000000000008','98000000-0000-0000-0000-000000000008',
  'b8000000-0000-0000-0000-000000000003', 0, '2026-03-11 10:00:00+00');
SELECT is((SELECT id FROM queue_internal.claim_next_send_at('c8000000-0000-0000-0000-000000000008', '2026-03-11 12:00:00+00')),
  'b8000000-0000-0000-0000-000000000003'::uuid, 'skipped não conta no teto (1 tentativa < teto 2)');
SELECT is((SELECT count(*)::int FROM queue_internal.claim_next_send_at('c8000000-0000-0000-0000-000000000008', '2026-03-11 12:02:30+00')), 0,
  'sending vivo bloqueia (e conta como tentativa)');

-- ---------- privilégios e hardening (A3, checklist B) ----------
SELECT ok(NOT has_function_privilege('anon','public.claim_next_send(uuid)','EXECUTE'), 'anon sem EXECUTE em claim_next_send');
SELECT ok(NOT has_function_privilege('authenticated','public.claim_next_send(uuid)','EXECUTE'), 'authenticated sem EXECUTE em claim_next_send');
SELECT ok(has_function_privilege('service_role','public.claim_next_send(uuid)','EXECUTE'), 'service_role executa claim_next_send');
SELECT ok(NOT has_function_privilege('authenticated','public.reap_expired_sends(uuid)','EXECUTE'), 'authenticated sem EXECUTE em reap_expired_sends');
SELECT ok(has_function_privilege('service_role','public.reap_expired_sends(uuid)','EXECUTE'), 'service_role executa reap_expired_sends');
SELECT ok(NOT has_function_privilege('anon','public.finish_send(uuid,text,text,text,text,text,text)','EXECUTE'), 'anon sem EXECUTE em finish_send');
SELECT ok(NOT has_function_privilege('authenticated','public.finish_send(uuid,text,text,text,text,text,text)','EXECUTE'), 'authenticated sem EXECUTE em finish_send');
SELECT ok(NOT has_function_privilege('service_role','queue_internal.claim_next_send_at(uuid,timestamptz)','EXECUTE'),
  'costura de teste (relógio do chamador) inacessível ao service_role');
SELECT ok(NOT has_schema_privilege('service_role','queue_internal','USAGE'), 'schema queue_internal fechado');
SELECT is((SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='public' AND p.proname IN ('claim_next_send','reap_expired_sends','finish_send','enqueue_send_now')
              AND p.prosecdef AND 'search_path=""' = ANY (p.proconfig)),
  4, 'as 4 RPCs são SECURITY DEFINER com search_path fixo');
SELECT is((SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='public' AND p.proname IN ('claim_next_send','reap_expired_sends','finish_send')
              AND has_function_privilege('public', p.oid, 'EXECUTE')),
  0, 'PUBLIC sem EXECUTE nas RPCs do worker');

SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT * FROM public.claim_next_send('c1000000-0000-0000-0000-000000000001')$$,
  '42501', NULL, 'authenticated não chama claim_next_send');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT * FROM public.claim_next_send('c1000000-0000-0000-0000-000000000001')$$,
  '42501', NULL, 'anon não chama claim_next_send');
RESET ROLE;

-- service_role de fato consegue chamar (RPC pública com now() do banco)
SELECT pg_temp.mk_send('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','c5000000-0000-0000-0000-000000000005','95000000-0000-0000-0000-000000000005',
  'b5000000-0000-0000-0000-000000000003', 0, now() - interval '1 minute');
SET LOCAL ROLE service_role;
SELECT is((SELECT count(*)::int FROM public.claim_next_send('c5000000-0000-0000-0000-000000000005')), 0,
  'service_role chama a RPC; reaper acabou de gravar finished_at => intervalo de 60 s barra');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
