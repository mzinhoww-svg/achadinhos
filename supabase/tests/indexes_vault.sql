CREATE EXTENSION IF NOT EXISTS pgtap;

BEGIN;

SELECT plan(4);

-- index checks
SELECT has_index('public', 'sends', 'sends_queue_idx', 'queue partial index exists');
SELECT has_index('public', 'sends', 'sends_dedupe_idx', 'dedupe partial index exists');

-- vault FK
INSERT INTO auth.users (id, aud, role, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'u1@t.com');
INSERT INTO public.accounts (account_id, user_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111');

SELECT throws_ok(
  $$INSERT INTO public.shopee_credentials (account_id, app_id, secret_id)
     VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'app', '00000000-0000-0000-0000-000000000000')$$,
  '23503',
  NULL,
  'shopee_credentials.secret_id FK to vault enforced'
);

SELECT throws_ok(
  $$INSERT INTO public.channels (account_id, kind, config_secret_id)
     VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'telegram', '00000000-0000-0000-0000-000000000000')$$,
  '23503',
  NULL,
  'channels.config_secret_id FK to vault enforced'
);

SELECT * FROM finish();
ROLLBACK;
