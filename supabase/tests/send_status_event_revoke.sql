CREATE EXTENSION IF NOT EXISTS pgtap;

BEGIN;

SELECT plan(3);

INSERT INTO auth.users (id, aud, role, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'u1@t.com');
INSERT INTO public.accounts (account_id, user_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111');

INSERT INTO public.sends (id, account_id, status) VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'queued');

-- as authenticated user, inserting a status event must be denied
SELECT set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$INSERT INTO public.send_status_events (account_id, send_id, old_status, new_status)
     VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'queued', 'sent')$$,
  '42501',
  NULL,
  'authenticated cannot insert send_status_events (B1)'
);

-- the original send status must remain unchanged
SELECT is(
  (SELECT status FROM public.sends WHERE id='cccccccc-cccc-cccc-cccc-cccccccccccc'),
  'queued',
  'send.status unchanged after denied event insert'
);

RESET ROLE;

-- service role / worker keeps full grant (sanity)
SET LOCAL ROLE service_role;
INSERT INTO public.send_status_events (account_id, send_id, old_status, new_status) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'queued', 'sent');
SELECT pass('service_role can emit status events');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
