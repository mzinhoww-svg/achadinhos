CREATE EXTENSION IF NOT EXISTS pgtap;

BEGIN;

SELECT plan(3);

INSERT INTO auth.users (id, aud, role, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'u1@t.com');
INSERT INTO public.accounts (account_id, user_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111');

DO $$
DECLARE a uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
        i int;
BEGIN
  FOR i IN 1..5 LOOP
    INSERT INTO public.automations (account_id, window_start, window_end, frequency_min)
      VALUES (a, '08:00'::time, '20:00'::time, 30);
  END LOOP;
END $$;

SELECT throws_ok(
  $$INSERT INTO public.automations (account_id, window_start, window_end, frequency_min)
     VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '08:00'::time, '20:00'::time, 30)$$,
  '23514',
  NULL,
  '6th automation rejected'
);

SELECT throws_ok(
  $$INSERT INTO public.automations (account_id, window_start, window_end, frequency_min)
     VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '08:00'::time, '20:00'::time, 45)$$,
  '23514',
  NULL,
  'invalid frequency_min rejected'
);

SELECT is(
  (SELECT count(*)::int FROM public.automations WHERE account_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  5,
  'account has exactly 5 automations'
);

SELECT * FROM finish();
ROLLBACK;
