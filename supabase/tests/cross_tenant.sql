CREATE EXTENSION IF NOT EXISTS pgtap;

BEGIN;
SELECT plan(5);

INSERT INTO auth.users (id, aud, role, email) VALUES
  ('11111111-1111-1111-1111-111111111111','authenticated','authenticated','u1@t.com'),
  ('22222222-2222-2222-2222-222222222222','authenticated','authenticated','u2@t.com');
INSERT INTO public.accounts (account_id,user_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','22222222-2222-2222-2222-222222222222');

-- account B resources
INSERT INTO public.channels (id,account_id,kind,config_secret_id)
  VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','telegram', vault.create_secret('cb'));
INSERT INTO public.groups (id,account_id,channel_id,external_id,sub_id)
  VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','cccccccc-cccc-cccc-cccc-cccccccccccc','ext-b','gb');
INSERT INTO public.shopee_credentials (account_id,app_id,secret_id)
  VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','appb', vault.create_secret('sb'));

-- account A channel/group
INSERT INTO public.channels (id,account_id,kind,config_secret_id)
  VALUES ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','telegram', vault.create_secret('ca'));
INSERT INTO public.groups (id,account_id,channel_id,external_id,sub_id)
  VALUES ('ffffffff-ffff-ffff-ffff-ffffffffffff','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','ext-a','ga');

-- offers
INSERT INTO public.offers (id,account_id,item_id) VALUES
  ('12121212-1212-1212-1212-121212121212','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','itb');

-- cross-tenant send blocked
SELECT throws_ok(
  $$INSERT INTO public.sends (account_id, group_id, channel_id, offer_id, idempotency_key)
     VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
             'dddddddd-dddd-dddd-dddd-dddddddddddd',
             'cccccccc-cccc-cccc-cccc-cccccccccccc',
             '12121212-1212-1212-1212-121212121212', 'k')$$,
  '23503', NULL, 'send cross-tenant blocked');

-- cross-tenant group→channel blocked
SELECT throws_ok(
  $$INSERT INTO public.groups (account_id,channel_id,external_id,sub_id)
     VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','cccccccc-cccc-cccc-cccc-cccccccccccc','x','gx')$$,
  '23503', NULL, 'group cross-tenant channel blocked');

-- cross-tenant automation_groups blocked
INSERT INTO public.automations (id,account_id,window_start,window_end,frequency_min) VALUES
  ('99999999-9999-9999-9999-999999999999','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','08:00','20:00',30);
SELECT throws_ok(
  $$INSERT INTO public.automation_groups (automation_id,account_id,group_id) VALUES
     ('99999999-9999-9999-9999-999999999999','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','dddddddd-dddd-dddd-dddd-dddddddddddd')$$,
  '23503', NULL, 'automation_groups cross-tenant group blocked');

-- cross-tenant vault secret reuse blocked
SELECT throws_ok(
  $$INSERT INTO public.shopee_credentials (account_id,app_id,secret_id)
     VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','app',
       (SELECT config_secret_id FROM public.channels WHERE id='cccccccc-cccc-cccc-cccc-cccccccccccc'))$$,
  '23503', NULL, 'vault secret reuse across accounts blocked');

-- duplicate same account ok (sanity)
INSERT INTO public.sends (account_id, group_id, channel_id, idempotency_key) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','ffffffff-ffff-ffff-ffff-ffffffffffff','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','k-same-tenant');
SELECT pass('same-tenant send ok');

SELECT * FROM finish();
ROLLBACK;
