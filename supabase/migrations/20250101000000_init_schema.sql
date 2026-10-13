-- achadinhos: schema inicial (multi-conta, RLS)
-- T2: schema Postgres e RLS

-- =========================================================
-- accounts
-- =========================================================
CREATE TABLE public.accounts (
  account_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  name text,
  timezone text NOT NULL DEFAULT 'America/Cuiaba',
  daily_cap_per_channel integer NOT NULL DEFAULT 200 CHECK (daily_cap_per_channel >= 0),
  dedupe_days integer NOT NULL DEFAULT 7 CHECK (dedupe_days >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.accounts IS 'Conta/dono. account_id e a chave de tenancy.';

-- =========================================================
-- shopee_credentials
-- =========================================================
CREATE TABLE public.shopee_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts (account_id) ON DELETE CASCADE,
  app_id text NOT NULL,
  secret_id uuid NOT NULL REFERENCES vault.secrets (id),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','valid','invalid','error')),
  last_error text,
  validated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id)
);

-- =========================================================
-- channels
-- =========================================================
CREATE TABLE public.channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts (account_id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('telegram','whatsapp')),
  config_secret_id uuid NOT NULL REFERENCES vault.secrets (id),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','inactive','error')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- =========================================================
-- groups
-- =========================================================
CREATE TABLE public.groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts (account_id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES public.channels (id) ON DELETE CASCADE,
  external_id text NOT NULL,
  name text,
  sub_id text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel_id, external_id)
);

-- =========================================================
-- automations
-- =========================================================
CREATE TABLE public.automations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts (account_id) ON DELETE CASCADE,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  days smallint[] NOT NULL DEFAULT ARRAY[]::smallint[],
  window_start time NOT NULL,
  window_end time NOT NULL,
  frequency_min integer NOT NULL CHECK (frequency_min IN (15, 30, 60)),
  header text,
  footer text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status in ('active','paused','archived')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- =========================================================
-- automation_groups
-- =========================================================
CREATE TABLE public.automation_groups (
  automation_id uuid NOT NULL REFERENCES public.automations (id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts (account_id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES public.groups (id) ON DELETE CASCADE,
  next_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (automation_id, group_id)
);

-- =========================================================
-- offers
-- =========================================================
CREATE TABLE public.offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts (account_id) ON DELETE CASCADE,
  item_id text NOT NULL,
  title text,
  price numeric,
  original_price numeric,
  discount_pct numeric,
  commission_rate numeric,
  rating numeric,
  sales integer,
  image_url text,
  product_url text,
  raw jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, item_id)
);

-- =========================================================
-- sends
-- =========================================================
CREATE TABLE public.sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts (account_id) ON DELETE CASCADE,
  offer_id uuid REFERENCES public.offers (id) ON DELETE SET NULL,
  group_id uuid REFERENCES public.groups (id) ON DELETE SET NULL,
  channel_id uuid REFERENCES public.channels (id) ON DELETE SET NULL,
  priority integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','sending','sent','failed','skipped')),
  reason text,
  short_link text,
  creative_url text,
  message_text text,
  external_message_id text,
  scheduled_for timestamptz,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sends_queue_idx
  ON public.sends (channel_id, status, priority DESC, scheduled_for)
  WHERE status = 'queued';

CREATE INDEX sends_dedupe_idx
  ON public.sends (group_id, offer_id, sent_at)
  WHERE status = 'sent';

-- =========================================================
-- commissions
-- =========================================================
CREATE TABLE public.commissions (
  account_id uuid NOT NULL REFERENCES public.accounts (account_id) ON DELETE CASCADE,
  checkout_id text NOT NULL,
  sub_ids text[],
  purchase_time timestamptz,
  estimated_commission numeric,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','confirmed','paid','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, checkout_id)
);

-- =========================================================
-- send_status_events (historico de mudanca de status)
-- =========================================================
CREATE TABLE public.send_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts (account_id) ON DELETE CASCADE,
  send_id uuid NOT NULL REFERENCES public.sends (id) ON DELETE CASCADE,
  old_status text,
  new_status text NOT NULL
    CHECK (new_status IN ('queued','sending','sent','failed','skipped')),
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid REFERENCES auth.users (id)
);

-- =========================================================
-- RLS
-- =========================================================
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shopee_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sends ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.send_status_events ENABLE ROW LEVEL SECURITY;

-- accounts
CREATE POLICY accounts_select ON public.accounts FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY accounts_insert ON public.accounts FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY accounts_update ON public.accounts FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY accounts_delete ON public.accounts FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- helper expression used below
-- child tables: full CRUD for owner of the account, except send* insert-only
CREATE POLICY shopee_credentials_all ON public.shopee_credentials FOR ALL TO authenticated
  USING (account_id IN (SELECT account_id FROM public.accounts WHERE user_id = auth.uid()))
  WITH CHECK (account_id IN (SELECT account_id FROM public.accounts WHERE user_id = auth.uid()));

CREATE POLICY channels_all ON public.channels FOR ALL TO authenticated
  USING (account_id IN (SELECT account_id FROM public.accounts WHERE user_id = auth.uid()))
  WITH CHECK (account_id IN (SELECT account_id FROM public.accounts WHERE user_id = auth.uid()));

CREATE POLICY groups_all ON public.groups FOR ALL TO authenticated
  USING (account_id IN (SELECT account_id FROM public.accounts WHERE user_id = auth.uid()))
  WITH CHECK (account_id IN (SELECT account_id FROM public.accounts WHERE user_id = auth.uid()));

CREATE POLICY automations_all ON public.automations FOR ALL TO authenticated
  USING (account_id IN (SELECT account_id FROM public.accounts WHERE user_id = auth.uid()))
  WITH CHECK (account_id IN (SELECT account_id FROM public.accounts WHERE user_id = auth.uid()));

CREATE POLICY automation_groups_all ON public.automation_groups FOR ALL TO authenticated
  USING (account_id IN (SELECT account_id FROM public.accounts WHERE user_id = auth.uid()))
  WITH CHECK (account_id IN (SELECT account_id FROM public.accounts WHERE user_id = auth.uid()));

CREATE POLICY offers_all ON public.offers FOR ALL TO authenticated
  USING (account_id IN (SELECT account_id FROM public.accounts WHERE user_id = auth.uid()))
  WITH CHECK (account_id IN (SELECT account_id FROM public.accounts WHERE user_id = auth.uid()));

-- sends: insert-only (+select)
CREATE POLICY sends_select ON public.sends FOR SELECT TO authenticated
  USING (account_id IN (SELECT account_id FROM public.accounts WHERE user_id = auth.uid()));
CREATE POLICY sends_insert ON public.sends FOR INSERT TO authenticated
  WITH CHECK (account_id IN (SELECT account_id FROM public.accounts WHERE user_id = auth.uid()));

-- commissions: insert-only (+select)
CREATE POLICY commissions_select ON public.commissions FOR SELECT TO authenticated
  USING (account_id IN (SELECT account_id FROM public.accounts WHERE user_id = auth.uid()));
CREATE POLICY commissions_insert ON public.commissions FOR INSERT TO authenticated
  WITH CHECK (account_id IN (SELECT account_id FROM public.accounts WHERE user_id = auth.uid()));

-- send_status_events: insert-only (+select)
CREATE POLICY send_status_events_select ON public.send_status_events FOR SELECT TO authenticated
  USING (account_id IN (SELECT account_id FROM public.accounts WHERE user_id = auth.uid()));
CREATE POLICY send_status_events_insert ON public.send_status_events FOR INSERT TO authenticated
  WITH CHECK (account_id IN (SELECT account_id FROM public.accounts WHERE user_id = auth.uid()));

-- FORCE RLS so table owners also obey (service role still bypasses via BYPASSRLS)
ALTER TABLE public.accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.shopee_credentials FORCE ROW LEVEL SECURITY;
ALTER TABLE public.channels FORCE ROW LEVEL SECURITY;
ALTER TABLE public.groups FORCE ROW LEVEL SECURITY;
ALTER TABLE public.automations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.automation_groups FORCE ROW LEVEL SECURITY;
ALTER TABLE public.offers FORCE ROW LEVEL SECURITY;
ALTER TABLE public.sends FORCE ROW LEVEL SECURITY;
ALTER TABLE public.commissions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.send_status_events FORCE ROW LEVEL SECURITY;

-- =========================================================
-- Triggers
-- =========================================================
-- 5 automations per account
CREATE OR REPLACE FUNCTION public.enforce_automation_limit()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT count(*) FROM public.automations WHERE account_id = NEW.account_id) >= 5 THEN
    RAISE EXCEPTION 'automation limit exceeded: max 5 per account' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER automations_limit_insert
  BEFORE INSERT ON public.automations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_automation_limit();

CREATE TRIGGER automations_limit_update
  BEFORE UPDATE OF account_id ON public.automations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_automation_limit();

-- sends immutability (direct update/delete blocked)
CREATE OR REPLACE FUNCTION public.send_immutable_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('achadinhos.internal_send_mutation', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'sends are insert-only' USING ERRCODE = 'insufficient_privilege';
END $$;

CREATE TRIGGER sends_immutable_update
  BEFORE UPDATE ON public.sends
  FOR EACH ROW EXECUTE FUNCTION public.send_immutable_guard();
CREATE TRIGGER sends_immutable_delete
  BEFORE DELETE ON public.sends
  FOR EACH ROW EXECUTE FUNCTION public.send_immutable_guard();

-- apply status change from send_status_events
CREATE OR REPLACE FUNCTION public.apply_send_status_event()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('achadinhos.internal_send_mutation', 'on', true);
  UPDATE public.sends
     SET status = NEW.new_status
   WHERE id = NEW.send_id AND account_id = NEW.account_id;
  RETURN NEW;
END $$;

CREATE TRIGGER send_status_event_applies
  AFTER INSERT ON public.send_status_events
  FOR EACH ROW EXECUTE FUNCTION public.apply_send_status_event();

-- commissions immutability
CREATE OR REPLACE FUNCTION public.immutable_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is insert-only' , TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END $$;

CREATE TRIGGER commissions_immutable_update
  BEFORE UPDATE ON public.commissions
  FOR EACH ROW EXECUTE FUNCTION public.immutable_guard();
CREATE TRIGGER commissions_immutable_delete
  BEFORE DELETE ON public.commissions
  FOR EACH ROW EXECUTE FUNCTION public.immutable_guard();

-- send_status_events immutability
CREATE TRIGGER send_status_events_immutable_update
  BEFORE UPDATE ON public.send_status_events
  FOR EACH ROW EXECUTE FUNCTION public.immutable_guard();
CREATE TRIGGER send_status_events_immutable_delete
  BEFORE DELETE ON public.send_status_events
  FOR EACH ROW EXECUTE FUNCTION public.immutable_guard();

-- grants
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
-- insert-only enforced by RLS + triggers; service_role bypasses RLS but triggers still apply.
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres;