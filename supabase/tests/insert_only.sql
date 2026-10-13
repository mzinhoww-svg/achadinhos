CREATE EXTENSION IF NOT EXISTS pgtap;

BEGIN;

SELECT plan(7);

INSERT INTO auth.users (id, aud, role, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'u1@t.com');
INSERT INTO public.accounts (account_id, user_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111');

INSERT INTO public.sends (id, account_id, status) VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'queued');

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

-- status event applies
INSERT INTO public.send_status_events (account_id, send_id, old_status, new_status)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'queued', 'sent');

SELECT is(
  (SELECT status FROM public.sends WHERE id='cccccccc-cccc-cccc-cccc-cccccccccccc'),
  'sent',
  'send_status_event updates send.status'
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
