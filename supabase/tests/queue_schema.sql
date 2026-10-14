-- T7-01: migração complementar da fila (colunas, índices, máquina de estados, guard por coluna,
-- fuso IANA, sub_id). Decisão 001: A1, A2, A5, A6, A7, M1, M4.
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
INSERT INTO public.groups (id, account_id, channel_id, external_id, sub_id) VALUES
  ('ffffffff-ffff-ffff-ffff-ffffffffffff','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','ext-a1','ga1'),
  ('f2f2f2f2-f2f2-f2f2-f2f2-f2f2f2f2f2f2','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','ext-a2','ga2'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','cccccccc-cccc-cccc-cccc-cccccccccccc','ext-b1','gb1');
INSERT INTO public.offers (id, account_id, item_id) VALUES
  ('77777777-7777-7777-7777-777777777771','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','i1'),
  ('77777777-7777-7777-7777-777777777772','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','i2'),
  ('77777777-7777-7777-7777-777777777773','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','i3');

-- ---------- colunas e constraints ----------
SELECT has_column('public','sends','idempotency_key','sends.idempotency_key existe');
SELECT has_column('public','sends','lease_expires_at','sends.lease_expires_at existe');
SELECT has_column('public','sends','attempted_at','sends.attempted_at existe');
SELECT has_column('public','sends','finished_at','sends.finished_at existe');
SELECT col_not_null('public','sends','idempotency_key','idempotency_key NOT NULL');

INSERT INTO public.sends (id, account_id, offer_id, group_id, channel_id, idempotency_key, priority) VALUES
  ('66666666-6666-6666-6666-666666666661','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '77777777-7777-7777-7777-777777777771','ffffffff-ffff-ffff-ffff-ffffffffffff',
   'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','auto1:ga1:2026-03-11T15:00Z', 5);

-- A1: mesma chave na mesma conta não duplica
SELECT throws_ok(
  $$INSERT INTO public.sends (account_id, group_id, channel_id, idempotency_key)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','ffffffff-ffff-ffff-ffff-ffffffffffff',
            'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','auto1:ga1:2026-03-11T15:00Z')$$,
  '23505', NULL, 'mesma (account_id, idempotency_key) não duplica');

-- ... mas outra conta pode usar a mesma chave
SELECT lives_ok(
  $$INSERT INTO public.sends (account_id, group_id, channel_id, idempotency_key)
    VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','dddddddd-dddd-dddd-dddd-dddddddddddd',
            'cccccccc-cccc-cccc-cccc-cccccccccccc','auto1:ga1:2026-03-11T15:00Z')$$,
  'a mesma chave em outra conta é permitida');

-- ---------- índices (A2, A5, A6, M4) ----------
SELECT has_index('public','sends','sends_one_sending_per_channel','unique parcial 1 sending por canal');
SELECT has_index('public','sends','sends_channel_attempted_idx','índice do teto (channel_id, attempted_at)');
SELECT has_index('public','sends','sends_dedupe_idx','índice de dedupe');
SELECT has_index('public','sends','sends_inflight_pair_uidx','unique parcial (group_id, offer_id) em voo');
SELECT matches(
  (SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname='sends_dedupe_idx'),
  'LIKE|~~.*\\_resultado\\_desconhecido',
  'dedupe cobre failed com qualquer motivo terminado em _resultado_desconhecido (A5/M4, Farol B2 do #13)');

-- M4: segundo queued do mesmo (group, offer) é recusado enquanto o primeiro está em voo
SELECT throws_ok(
  $$INSERT INTO public.sends (account_id, offer_id, group_id, channel_id, idempotency_key)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','77777777-7777-7777-7777-777777777771',
            'ffffffff-ffff-ffff-ffff-ffffffffffff','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','outra-chave')$$,
  '23505', NULL, 'par (group, offer) em voo não empilha');

-- ---------- A2: 1 sending por canal ----------
SELECT throws_ok(
  $$UPDATE public.sends SET status='sending' WHERE id='66666666-6666-6666-6666-666666666661'$$,
  '23514', NULL, 'sending exige lease_expires_at e attempted_at (CHECK)');

UPDATE public.sends
   SET status='sending', lease_expires_at = now() + interval '120 seconds', attempted_at = now()
 WHERE id='66666666-6666-6666-6666-666666666661';
SELECT is((SELECT status FROM public.sends WHERE id='66666666-6666-6666-6666-666666666661'),
          'sending', 'queued -> sending permitido');

INSERT INTO public.sends (id, account_id, offer_id, group_id, channel_id, idempotency_key) VALUES
  ('66666666-6666-6666-6666-666666666662','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '77777777-7777-7777-7777-777777777772','ffffffff-ffff-ffff-ffff-ffffffffffff',
   'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','k2');
SELECT throws_ok(
  $$UPDATE public.sends
       SET status='sending', lease_expires_at = now() + interval '120 seconds', attempted_at = now()
     WHERE id='66666666-6666-6666-6666-666666666662'$$,
  '23505', NULL, '2º sending no mesmo canal é rejeitado pelo banco');

-- M1: cada transição gera uma linha em send_status_events
SELECT is(
  (SELECT count(*)::int FROM public.send_status_events
    WHERE send_id='66666666-6666-6666-6666-666666666661' AND old_status='queued' AND new_status='sending'),
  1, 'transição queued -> sending gera evento');

-- ---------- M1: máquina de estados ----------
SELECT throws_ok(
  $$UPDATE public.sends SET status='sent' WHERE id='66666666-6666-6666-6666-666666666662'$$,
  '42501', NULL, 'queued -> sent (pulando sending) é recusado');

UPDATE public.sends SET status='sent', finished_at = now(), sent_at = now(), external_message_id='m1'
 WHERE id='66666666-6666-6666-6666-666666666661';
SELECT is((SELECT status FROM public.sends WHERE id='66666666-6666-6666-6666-666666666661'),
          'sent', 'sending -> sent permitido');

SELECT throws_ok(
  $$UPDATE public.sends SET status='queued' WHERE id='66666666-6666-6666-6666-666666666661'$$,
  '42501', NULL, 'sent -> queued é recusado');
SELECT throws_ok(
  $$UPDATE public.sends SET status='failed', finished_at=now() WHERE id='66666666-6666-6666-6666-666666666661'$$,
  '42501', NULL, 'sent -> failed é recusado');
SELECT throws_ok(
  $$UPDATE public.sends SET message_text='editado' WHERE id='66666666-6666-6666-6666-666666666661'$$,
  '42501', NULL, 'linha em estado terminal não aceita mais alteração');

SELECT throws_ok(
  $$UPDATE public.sends SET status='sent' WHERE id='66666666-6666-6666-6666-666666666662'$$,
  '42501', NULL, 'queued -> sent direto continua recusado');
SELECT throws_ok(
  $$UPDATE public.sends SET status='bogus' WHERE id='66666666-6666-6666-6666-666666666662'$$,
  '23514', NULL, 'status fora do enum é recusado');

-- status terminal exige finished_at
SELECT throws_ok(
  $$UPDATE public.sends SET status='skipped' WHERE id='66666666-6666-6666-6666-666666666662'$$,
  '23514', NULL, 'estado terminal exige finished_at (CHECK)');

-- GUC antigo não libera nada
SELECT set_config('achadinhos.internal_send_mutation','on',true);
SELECT throws_ok(
  $$UPDATE public.sends SET status='sent' WHERE id='66666666-6666-6666-6666-666666666662'$$,
  '42501', NULL, 'GUC liberável pela sessão não abre o guard');

-- ---------- M1: identidade imutável ----------
SELECT throws_ok(
  $$UPDATE public.sends SET priority = 100 WHERE id='66666666-6666-6666-6666-666666666662'$$,
  '42501', NULL, 'priority é imutável');
SELECT throws_ok(
  $$UPDATE public.sends SET idempotency_key = 'trocada' WHERE id='66666666-6666-6666-6666-666666666662'$$,
  '42501', NULL, 'idempotency_key é imutável');
SELECT throws_ok(
  $$UPDATE public.sends SET group_id='f2f2f2f2-f2f2-f2f2-f2f2-f2f2f2f2f2f2' WHERE id='66666666-6666-6666-6666-666666666662'$$,
  '42501', NULL, 'group_id só pode ir para NULL, não para outro grupo');
SELECT throws_ok(
  $$UPDATE public.sends SET scheduled_for = now() + interval '1 day' WHERE id='66666666-6666-6666-6666-666666666662'$$,
  '42501', NULL, 'scheduled_for é imutável');
SELECT throws_ok(
  $$UPDATE public.sends SET account_id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' WHERE id='66666666-6666-6666-6666-666666666662'$$,
  '42501', NULL, 'account_id é imutável');
SELECT throws_ok(
  $$UPDATE public.sends SET created_at = now() - interval '1 year' WHERE id='66666666-6666-6666-6666-666666666662'$$,
  '42501', NULL, 'created_at é imutável');
SELECT throws_ok(
  $$DELETE FROM public.sends WHERE id='66666666-6666-6666-6666-666666666662'$$,
  '42501', NULL, 'DELETE direto continua recusado');

-- ---------- M1: apagar com histórico funciona ----------
SELECT lives_ok($$DELETE FROM public.offers WHERE id='77777777-7777-7777-7777-777777777772'$$,
  'deletar oferta com histórico funciona');
SELECT is((SELECT offer_id FROM public.sends WHERE id='66666666-6666-6666-6666-666666666662'),
          NULL::uuid, 'oferta apagada anula sends.offer_id');
SELECT lives_ok($$DELETE FROM public.groups WHERE id='f2f2f2f2-f2f2-f2f2-f2f2-f2f2f2f2f2f2'$$,
  'deletar grupo sem histórico funciona');
SELECT lives_ok($$DELETE FROM public.groups WHERE id='ffffffff-ffff-ffff-ffff-ffffffffffff'$$,
  'deletar grupo com histórico funciona');
SELECT is((SELECT group_id FROM public.sends WHERE id='66666666-6666-6666-6666-666666666661'),
          NULL::uuid, 'grupo apagado anula sends.group_id (mesmo em linha terminal)');
SELECT lives_ok($$DELETE FROM public.channels WHERE id='eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'$$,
  'deletar canal com histórico funciona');
SELECT lives_ok($$DELETE FROM public.accounts WHERE account_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,
  'deletar conta com histórico (LGPD) funciona');
SELECT is((SELECT count(*)::int FROM public.sends WHERE account_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
          0, 'exclusão da conta leva o histórico em cascata');

-- ---------- authenticated: sem INSERT/UPDATE/DELETE direto em sends (M2) ----------
SELECT set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$INSERT INTO public.sends (account_id, group_id, channel_id, idempotency_key, status, priority)
    VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','dddddddd-dddd-dddd-dddd-dddddddddddd',
            'cccccccc-cccc-cccc-cccc-cccccccccccc','x','sent',100)$$,
  '42501', NULL, 'authenticated não insere em sends');
SELECT throws_ok(
  $$UPDATE public.sends SET priority = 100 WHERE account_id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'$$,
  '42501', NULL, 'authenticated não atualiza sends');
SELECT throws_ok(
  $$DELETE FROM public.sends WHERE account_id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'$$,
  '42501', NULL, 'authenticated não deleta sends');
SELECT is((SELECT count(*)::int FROM public.sends), 1, 'authenticated continua lendo os próprios sends');
RESET ROLE;

-- ---------- A7: fuso IANA ----------
SELECT throws_ok(
  $$UPDATE public.accounts SET timezone='America/Nowhere' WHERE account_id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'$$,
  '23514', NULL, 'fuso inexistente é recusado');
SELECT throws_ok(
  $$UPDATE public.accounts SET timezone='-04' WHERE account_id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'$$,
  '23514', NULL, 'offset fixo -04 é recusado');
SELECT throws_ok(
  $$UPDATE public.accounts SET timezone='UTC+4' WHERE account_id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'$$,
  '23514', NULL, 'POSIX UTC+4 é recusado');
SELECT lives_ok(
  $$UPDATE public.accounts SET timezone='America/Sao_Paulo' WHERE account_id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'$$,
  'IANA válido é aceito');
SELECT throws_ok(
  $$INSERT INTO public.accounts (user_id, timezone) VALUES ('11111111-1111-1111-1111-111111111111','Mars/Olympus')$$,
  '23514', NULL, 'INSERT com fuso inválido é recusado');

-- ---------- groups.sub_id ----------
SELECT col_not_null('public','groups','sub_id','groups.sub_id NOT NULL');
SELECT throws_ok(
  $$INSERT INTO public.groups (account_id, channel_id, external_id, sub_id)
    VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','cccccccc-cccc-cccc-cccc-cccccccccccc','ext-b2','gb1')$$,
  '23505', NULL, 'sub_id é único por conta');
INSERT INTO public.accounts (account_id, user_id) VALUES
  ('a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0','11111111-1111-1111-1111-111111111111');
INSERT INTO public.channels (id, account_id, kind, config_secret_id) VALUES
  ('c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1','a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0','telegram', vault.create_secret('cx'));
SELECT lives_ok(
  $$INSERT INTO public.groups (account_id, channel_id, external_id, sub_id)
    VALUES ('a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0','c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1','ext-x','gb1')$$,
  'mesmo sub_id em outra conta é permitido');
SELECT throws_ok(
  $$UPDATE public.groups SET sub_id='trocado' WHERE id='dddddddd-dddd-dddd-dddd-dddddddddddd'$$,
  '42501', NULL, 'sub_id é imutável');
SELECT lives_ok(
  $$UPDATE public.groups SET active=false WHERE id='dddddddd-dddd-dddd-dddd-dddddddddddd'$$,
  'desativar grupo (outras colunas) continua permitido');

SELECT * FROM finish();
ROLLBACK;
