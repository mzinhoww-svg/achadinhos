CREATE EXTENSION IF NOT EXISTS pgtap;

BEGIN;

SELECT plan(5);

-- setup users + accounts (as postgres)
INSERT INTO auth.users (id, aud, role, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'u1@t.com'),
  ('22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'u2@t.com');

INSERT INTO public.accounts (account_id, user_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222');

INSERT INTO public.offers (account_id, item_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'item-a1'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'item-a2'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'item-b1');

-- as user 1: sees own rows only
SELECT set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.offers),
  2,
  'user1 sees only its 2 offers'
);

-- cross-account insert blocked
SELECT throws_ok(
  $$INSERT INTO public.offers (account_id, item_id) VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'hack')$$,
  '42501',
  NULL,
  'user1 cannot insert into another account'
);

-- as user 2: sees own rows only
SELECT set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
SELECT is(
  (SELECT count(*)::int FROM public.offers),
  1,
  'user2 sees only its 1 offer'
);

-- anon has no privileges on public tables (B1)
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT throws_ok(
  $$SELECT count(*)::int FROM public.offers$$,
  '42501',
  NULL,
  'anon has no access to offers'
);

-- force back for cleanup
RESET ROLE;

SELECT pass('reset completed');

SELECT * FROM finish();
ROLLBACK;
