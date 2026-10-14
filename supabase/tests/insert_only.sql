CREATE EXTENSION IF NOT EXISTS pgtap;

BEGIN;

SELECT plan(7);

INSERT INTO auth.users (id, aud, role, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'u1@t.com');
INSERT INTO public.accounts (account_id, user_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111');

INSERT INTO public.sends (id, account_id, status, idempotency_key) VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'queued', 'k-insert-only');

-- direct update blocked
SELECT throws_ok(
  $$UPDATE public.sends SET status='sent' WHERE id='cccccccc-cccc-cccc-cccc-cccccccccccc'$$,
  '42501',
  NULL,
  'sends direct update blocked'
);

-- direct delete blocked
SELECT throws_ok(
  $$DELETE FROM public.sends WHERE id='cccccccc-cccc-cccc-cccc-cccccccccccc'$$,
  '42501',
  NULL,
  'sends direct delete blocked'
);

-- T7-01 (M1): o estado manda no log; uma transicao valida gera o evento
UPDATE public.sends
   SET status='sending', lease_expires_at = now() + interval '120 seconds', attempted_at = now()
 WHERE id='cccccccc-cccc-cccc-cccc-cccccccccccc';
UPDATE public.sends SET status='sent', finished_at = now(), sent_at = now()
 WHERE id='cccccccc-cccc-cccc-cccc-cccccccccccc';

SELECT is(
  (SELECT array_agg(new_status ORDER BY changed_at, new_status) FROM public.send_status_events
    WHERE send_id='cccccccc-cccc-cccc-cccc-cccccccccccc'),
  ARRAY['sending','sent'],
  'transicoes de sends geram send_status_events'
);

-- event update/delete blocked
SELECT throws_ok(
  $$UPDATE public.send_status_events SET new_status='failed' WHERE send_id='cccccccc-cccc-cccc-cccc-cccccccccccc'$$,
  '42501',
  NULL,
  'send_status_events update blocked'
);
SELECT throws_ok(
  $$DELETE FROM public.send_status_events WHERE send_id='cccccccc-cccc-cccc-cccc-cccccccccccc'$$,
  '42501',
  NULL,
  'send_status_events delete blocked'
);

-- commissions insert + immutability
INSERT INTO public.commissions (account_id, checkout_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'chk-1');

SELECT throws_ok(
  $$UPDATE public.commissions SET status='confirmed' WHERE account_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND checkout_id='chk-1'$$,
  '42501',
  NULL,
  'commissions update blocked'
);
SELECT throws_ok(
  $$DELETE FROM public.commissions WHERE account_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND checkout_id='chk-1'$$,
  '42501',
  NULL,
  'commissions delete blocked'
);

SELECT * FROM finish();
ROLLBACK;
