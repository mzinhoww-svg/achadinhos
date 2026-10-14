-- achadinhos: T7-01..T7-03 — SQL da fila de envios (decisão 001, A1–A9 e M1–M4)
-- Complementa 20250101000000_init_schema.sql. Tempo sempre pelo relógio do banco.
-- Dono das funções: o role que roda a migração (postgres no Supabase, com BYPASSRLS).

-- =========================================================
-- T7-01 · parte 1: remover o guard antigo (GUC liberável pela sessão, M1)
-- =========================================================
DROP TRIGGER IF EXISTS sends_immutable_update ON public.sends;
DROP TRIGGER IF EXISTS sends_immutable_delete ON public.sends;
DROP TRIGGER IF EXISTS send_status_event_applies ON public.send_status_events;
DROP FUNCTION IF EXISTS public.send_immutable_guard();
-- O estado agora manda no log (sends -> send_status_events), nunca o contrário.
DROP FUNCTION IF EXISTS public.apply_send_status_event();

-- =========================================================
-- T7-01 · parte 2: colunas, backfill, constraints
-- =========================================================
ALTER TABLE public.sends
  ADD COLUMN idempotency_key text,
  ADD COLUMN lease_expires_at timestamptz,
  ADD COLUMN attempted_at timestamptz,
  ADD COLUMN finished_at timestamptz;

UPDATE public.sends SET idempotency_key = 'legacy:' || id::text WHERE idempotency_key IS NULL;
UPDATE public.sends
   SET finished_at = coalesce(sent_at, created_at),
       attempted_at = CASE WHEN status IN ('sent','failed') THEN coalesce(sent_at, created_at) END
 WHERE status IN ('sent','failed','skipped') AND finished_at IS NULL;

ALTER TABLE public.sends
  ALTER COLUMN idempotency_key SET NOT NULL,
  ADD CONSTRAINT sends_account_idempotency_key UNIQUE (account_id, idempotency_key),
  ADD CONSTRAINT sends_sending_requires_lease
    CHECK (status <> 'sending' OR (lease_expires_at IS NOT NULL AND attempted_at IS NOT NULL)),
  ADD CONSTRAINT sends_terminal_requires_finished
    CHECK (status NOT IN ('sent','failed','skipped') OR finished_at IS NOT NULL);

-- A2: o banco recusa o 2º sending do canal, mesmo que o código erre
CREATE UNIQUE INDEX sends_one_sending_per_channel
  ON public.sends (channel_id) WHERE status = 'sending';

-- A6: teto por canal/dia local
CREATE INDEX sends_channel_attempted_idx
  ON public.sends (channel_id, attempted_at) WHERE attempted_at IS NOT NULL;

-- claim: prioridade desc, mais antigo primeiro (NULL = imediato)
DROP INDEX public.sends_queue_idx;
CREATE INDEX sends_queue_idx
  ON public.sends (channel_id, priority DESC, scheduled_for ASC NULLS FIRST, created_at, id)
  WHERE status = 'queued';

-- A5/M4: dedupe enxerga também failed com resultado desconhecido
DROP INDEX public.sends_dedupe_idx;
CREATE INDEX sends_dedupe_idx
  ON public.sends (group_id, offer_id, attempted_at)
  WHERE status = 'sent'
     OR (status = 'failed' AND reason = 'lease_expirado_resultado_desconhecido');

-- M4: um mesmo (grupo, oferta) não empilha em voo; a janela de dedupe_days fica na consulta
CREATE UNIQUE INDEX sends_inflight_pair_uidx
  ON public.sends (group_id, offer_id) WHERE status IN ('queued','sending');

-- =========================================================
-- T7-01 · parte 3: guard por coluna + log de transições (M1)
-- =========================================================
CREATE FUNCTION public.sends_update_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  -- identidade: imutável
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.account_id IS DISTINCT FROM OLD.account_id
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.priority IS DISTINCT FROM OLD.priority
     OR NEW.scheduled_for IS DISTINCT FROM OLD.scheduled_for
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'sends: coluna de identidade e imutavel' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- referencias: so podem ir para NULL (acao de FK ao apagar grupo/oferta/canal)
  IF (NEW.offer_id IS DISTINCT FROM OLD.offer_id AND NEW.offer_id IS NOT NULL)
     OR (NEW.group_id IS DISTINCT FROM OLD.group_id AND NEW.group_id IS NOT NULL)
     OR (NEW.channel_id IS DISTINCT FROM OLD.channel_id AND NEW.channel_id IS NOT NULL) THEN
    RAISE EXCEPTION 'sends: referencia so pode ser anulada' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- estado terminal: nada muda, exceto a anulacao de FK acima
  IF OLD.status IN ('sent','failed','skipped') THEN
    IF (to_jsonb(NEW) - 'offer_id' - 'group_id' - 'channel_id')
       IS DISTINCT FROM (to_jsonb(OLD) - 'offer_id' - 'group_id' - 'channel_id') THEN
      RAISE EXCEPTION 'sends: linha em estado terminal e imutavel' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  -- transicoes so para frente (status fora do enum fica para o CHECK)
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('queued','sending','sent','failed','skipped') THEN
    IF NOT ((OLD.status = 'queued'  AND NEW.status IN ('sending','skipped'))
         OR (OLD.status = 'sending' AND NEW.status IN ('sent','failed','skipped'))) THEN
      RAISE EXCEPTION 'sends: transicao % -> % invalida', OLD.status, NEW.status
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER sends_update_guard
  BEFORE UPDATE ON public.sends
  FOR EACH ROW EXECUTE FUNCTION public.sends_update_guard();

-- DELETE direto proibido; permitido apenas em cascata (exclusao da conta, LGPD)
CREATE FUNCTION public.sends_delete_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'sends are insert-only' USING ERRCODE = 'insufficient_privilege';
END $$;

CREATE TRIGGER sends_delete_guard
  BEFORE DELETE ON public.sends
  FOR EACH ROW EXECUTE FUNCTION public.sends_delete_guard();

-- cada transicao gera uma linha so de insercao; changed_by fica NULL (ator = worker)
CREATE FUNCTION public.sends_log_status_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.send_status_events (account_id, send_id, old_status, new_status)
  VALUES (NEW.account_id, NEW.id, OLD.status, NEW.status);
  RETURN NULL;
END $$;

CREATE TRIGGER sends_log_status_event
  AFTER UPDATE OF status ON public.sends
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.sends_log_status_event();

REVOKE ALL ON FUNCTION public.sends_update_guard(), public.sends_delete_guard(),
  public.sends_log_status_event() FROM PUBLIC, anon, authenticated;

-- M2: cliente nao insere/atualiza/apaga sends; entrada por enqueue_send_now
DROP POLICY IF EXISTS sends_insert ON public.sends;
REVOKE INSERT, UPDATE, DELETE ON public.sends FROM authenticated;

-- =========================================================
-- T7-01 · parte 4: fuso IANA e groups.sub_id
-- =========================================================
CREATE FUNCTION public.accounts_validate_timezone()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.timezone !~ '^[A-Za-z]+(/[A-Za-z0-9_+-]+)+$'
     OR NEW.timezone ~ '^Etc/'
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = NEW.timezone) THEN
    RAISE EXCEPTION 'accounts.timezone deve ser um nome IANA Regiao/Cidade: %', NEW.timezone
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER accounts_validate_timezone
  BEFORE INSERT OR UPDATE OF timezone ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.accounts_validate_timezone();

REVOKE ALL ON FUNCTION public.accounts_validate_timezone() FROM PUBLIC, anon, authenticated;

UPDATE public.groups
   SET sub_id = 'g' || substr(replace(id::text, '-', ''), 1, 12)
 WHERE sub_id IS NULL;

ALTER TABLE public.groups
  ALTER COLUMN sub_id SET NOT NULL,
  ADD CONSTRAINT groups_account_sub_id_key UNIQUE (account_id, sub_id);

CREATE FUNCTION public.groups_sub_id_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'groups.sub_id e imutavel' USING ERRCODE = 'insufficient_privilege';
END $$;

CREATE TRIGGER groups_sub_id_guard
  BEFORE UPDATE OF sub_id ON public.groups
  FOR EACH ROW WHEN (OLD.sub_id IS DISTINCT FROM NEW.sub_id)
  EXECUTE FUNCTION public.groups_sub_id_guard();

REVOKE ALL ON FUNCTION public.groups_sub_id_guard() FROM PUBLIC, anon, authenticated;

-- =========================================================
-- T7-02 · helpers internos (schema fora do PostgREST, sem USAGE para ninguem)
-- =========================================================
CREATE SCHEMA queue_internal;
REVOKE ALL ON SCHEMA queue_internal FROM PUBLIC;

-- M3: [inicio, fim) do dia local de `tz` que contem p_now
CREATE FUNCTION queue_internal.local_day_bounds(p_tz text, p_now timestamptz)
RETURNS TABLE (day_start timestamptz, day_end timestamptz)
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT date_trunc('day', p_now AT TIME ZONE p_tz) AT TIME ZONE p_tz,
         (date_trunc('day', p_now AT TIME ZONE p_tz) + interval '1 day') AT TIME ZONE p_tz
$$;

-- A4: sending com lease vencido vira failed (sem retry: o envio pode ter chegado)
CREATE FUNCTION queue_internal.reap_expired_at(p_channel_id uuid, p_now timestamptz)
RETURNS integer LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.sends
     SET status = 'failed',
         reason = 'lease_expirado_resultado_desconhecido',
         finished_at = p_now
   WHERE status = 'sending'
     AND lease_expires_at < p_now
     AND (p_channel_id IS NULL OR channel_id = p_channel_id);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

-- A3: claim atomico. p_now existe so como costura de teste; a RPC publica passa now() do banco.
CREATE FUNCTION queue_internal.claim_next_send_at(p_channel_id uuid, p_now timestamptz)
RETURNS SETOF public.sends LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  c_lease constant interval := interval '120 seconds';
  c_gap   constant interval := interval '60 seconds';
  v_tz            text;
  v_cap           integer;
  v_channel_state text;
  v_day_start     timestamptz;
  v_day_end       timestamptz;
  v_last_finished timestamptz;
  v_send          public.sends;
BEGIN
  -- (1) lock de TRANSACAO (pooler em modo transacao); contencao = nada a fazer agora
  IF NOT pg_try_advisory_xact_lock(hashtext('achadinhos.claim_next_send'), hashtext(p_channel_id::text)) THEN
    RETURN;
  END IF;

  SELECT a.timezone, a.daily_cap_per_channel, c.status
    INTO v_tz, v_cap, v_channel_state
    FROM public.channels c
    JOIN public.accounts a ON a.account_id = c.account_id
   WHERE c.id = p_channel_id;
  IF NOT FOUND OR v_channel_state <> 'active' THEN
    RETURN;
  END IF;

  -- (2) reaper do canal
  PERFORM queue_internal.reap_expired_at(p_channel_id, p_now);

  -- (3a) ha envio vivo
  IF EXISTS (SELECT 1 FROM public.sends WHERE channel_id = p_channel_id AND status = 'sending') THEN
    RETURN;
  END IF;

  -- (3b) intervalo minimo desde o fim da ultima tentativa
  SELECT finished_at INTO v_last_finished
    FROM public.sends
   WHERE channel_id = p_channel_id AND attempted_at IS NOT NULL
   ORDER BY attempted_at DESC
   LIMIT 1;
  IF v_last_finished IS NOT NULL AND v_last_finished > p_now - c_gap THEN
    RETURN;
  END IF;

  -- (3c) teto no dia local da conta (sending + sent + failed = attempted_at preenchido)
  SELECT d.day_start, d.day_end INTO v_day_start, v_day_end
    FROM queue_internal.local_day_bounds(v_tz, p_now) d;
  IF (SELECT count(*) FROM public.sends
       WHERE channel_id = p_channel_id
         AND attempted_at >= v_day_start AND attempted_at < v_day_end) >= v_cap THEN
    RETURN;
  END IF;

  -- (4) prioridade desc, mais antigo primeiro; SKIP LOCKED
  SELECT * INTO v_send
    FROM public.sends
   WHERE channel_id = p_channel_id
     AND status = 'queued'
     AND (scheduled_for IS NULL OR scheduled_for <= p_now)
   ORDER BY priority DESC, scheduled_for ASC NULLS FIRST, created_at, id
   LIMIT 1
   FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- (5) sending + lease
  UPDATE public.sends
     SET status = 'sending',
         lease_expires_at = p_now + c_lease,
         attempted_at = p_now
   WHERE id = v_send.id
  RETURNING * INTO v_send;

  RETURN NEXT v_send;
END $$;

REVOKE ALL ON FUNCTION queue_internal.local_day_bounds(text, timestamptz),
  queue_internal.reap_expired_at(uuid, timestamptz),
  queue_internal.claim_next_send_at(uuid, timestamptz) FROM PUBLIC;

-- =========================================================
-- T7-02/T7-03 · RPCs do worker (EXECUTE so service_role)
-- =========================================================
CREATE FUNCTION public.claim_next_send(p_channel_id uuid)
RETURNS SETOF public.sends
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT * FROM queue_internal.claim_next_send_at(p_channel_id, now())
$$;

CREATE FUNCTION public.reap_expired_sends(p_channel_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT queue_internal.reap_expired_at(p_channel_id, now())
$$;

-- Encerra um envio. Retorna false se a linha nao esta mais 'sending' (lease perdido para o
-- reaper, ja finalizada ou inexistente); queued -> skipped tambem e aceito (fora_da_janela).
CREATE FUNCTION public.finish_send(
  p_send_id             uuid,
  p_status              text,
  p_reason              text DEFAULT NULL,
  p_external_message_id text DEFAULT NULL,
  p_short_link          text DEFAULT NULL,
  p_creative_url        text DEFAULT NULL,
  p_message_text        text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_current text;
BEGIN
  IF p_status NOT IN ('sent','failed','skipped') THEN
    RAISE EXCEPTION 'finish_send: status invalido %', p_status USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_status = 'sent' AND coalesce(btrim(p_external_message_id), '') = '' THEN
    RAISE EXCEPTION 'finish_send: external_message_id obrigatorio para sent' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_status IN ('failed','skipped') AND coalesce(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'finish_send: reason obrigatorio para %', p_status USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT status INTO v_current FROM public.sends WHERE id = p_send_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF NOT (v_current = 'sending' OR (v_current = 'queued' AND p_status = 'skipped')) THEN
    RETURN false;
  END IF;

  UPDATE public.sends
     SET status = p_status,
         reason = left(p_reason, 500),
         finished_at = now(),
         sent_at = CASE WHEN p_status = 'sent' THEN now() END,
         external_message_id = coalesce(p_external_message_id, external_message_id),
         short_link = coalesce(p_short_link, short_link),
         creative_url = coalesce(p_creative_url, creative_url),
         message_text = coalesce(p_message_text, message_text)
   WHERE id = p_send_id;
  RETURN true;
END $$;

-- =========================================================
-- M2 · "Mandar agora": unica porta de entrada do cliente na fila
-- =========================================================
CREATE FUNCTION public.enqueue_send_now(p_group_id uuid, p_offer_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_group   public.groups;
  v_key     text;
  v_send_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT g.* INTO v_group
    FROM public.groups g
    JOIN public.accounts a ON a.account_id = g.account_id
   WHERE g.id = p_group_id AND a.user_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  PERFORM 1 FROM public.offers o
   WHERE o.id = p_offer_id AND o.account_id = v_group.account_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT v_group.active THEN
    RAISE EXCEPTION 'group_inactive' USING ERRCODE = 'check_violation';
  END IF;

  -- anti duplo clique: mesma chave no mesmo minuto + unico (grupo, oferta) em voo
  v_key := 'now:' || p_group_id::text || ':' || p_offer_id::text || ':'
        || floor(extract(epoch FROM now()) / 60)::bigint::text;

  INSERT INTO public.sends
    (account_id, offer_id, group_id, channel_id, priority, status, scheduled_for, idempotency_key)
  VALUES
    (v_group.account_id, p_offer_id, p_group_id, v_group.channel_id, 100, 'queued', now(), v_key)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_send_id;

  IF v_send_id IS NULL THEN
    SELECT s.id INTO v_send_id
      FROM public.sends s
     WHERE s.account_id = v_group.account_id
       AND (s.idempotency_key = v_key
            OR (s.group_id = p_group_id AND s.offer_id = p_offer_id
                AND s.status IN ('queued','sending')))
     ORDER BY s.created_at DESC
     LIMIT 1;
  END IF;

  RETURN v_send_id;
END $$;

-- EXECUTE: o padrao do Supabase concede a anon/authenticated/service_role; fechamos explicitamente
REVOKE ALL ON FUNCTION public.claim_next_send(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reap_expired_sends(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_send(uuid, text, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_send(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.reap_expired_sends(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_send(uuid, text, text, text, text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.enqueue_send_now(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_send_now(uuid, uuid) TO authenticated;
