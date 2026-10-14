CREATE EXTENSION IF NOT EXISTS pgtap;

BEGIN;
SELECT plan(4);

INSERT INTO auth.users (id, aud, role, email) VALUES
  ('11111111-1111-1111-1111-111111111111','authenticated','authenticated','u1@t.com');
INSERT INTO public.accounts (account_id,user_id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111');

INSERT INTO public.channels (id,account_id,kind,config_secret_id) VALUES
  ('99999999-9999-9999-9999-999999999999','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','telegram', vault.create_secret('c'));
INSERT INTO public.groups (id,account_id,channel_id,external_id) VALUES
  ('88888888-8888-8888-8888-888888888888','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','99999999-9999-9999-9999-999999999999','g');
INSERT INTO public.offers (id,account_id,item_id) VALUES
  ('77777777-7777-7777-7777-777777777777','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','it');
INSERT INTO public.sends (id,account_id,offer_id,group_id,channel_id) VALUES
  ('66666666-6666-6666-6666-666666666666','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','77777777-7777-7777-7777-777777777777','88888888-8888-8888-8888-888888888888','99999999-9999-9999-9999-999999999999');
INSERT INTO public.send_status_events (account_id,send_id,old_status,new_status) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','66666666-6666-6666-6666-666666666666','queued','sent');

-- delete offer should null offer_id in send, not fail
DELETE FROM public.offers WHERE id='77777777-7777-7777-7777-777777777777';
SELECT is((SELECT offer_id FROM public.sends WHERE id='66666666-6666-6666-6666-666666666666'), NULL::uuid, 'offer delete nulls send.offer_id');

-- delete group should null group
DELETE FROM public.groups WHERE id='88888888-8888-8888-8888-888888888888';
SELECT is((SELECT group_id FROM public.sends WHERE id='66666666-6666-6666-6666-666666666666'), NULL::uuid, 'group delete nulls send.group_id');

-- delete account should cascade all (no error)
DELETE FROM public.accounts WHERE account_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
SELECT is((SELECT count(*)::int FROM public.sends WHERE id='66666666-6666-6666-6666-666666666666'), 0, 'account delete cascades send');
SELECT is((SELECT count(*)::int FROM public.send_status_events WHERE send_id='66666666-6666-6666-6666-666666666666'), 0, 'account delete cascades event');

SELECT * FROM finish();
ROLLBACK;
