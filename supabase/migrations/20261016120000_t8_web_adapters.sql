-- achadinhos: T8-10 — contrato SQL dos adaptadores do apps/web (decisão 003 H1: o painel nunca lê o Secret).
-- Toda entrada do painel passa por RPC `web_*`: a conta vem de auth.uid() (nunca de parâmetro),
-- leituras/escritas de tabela são SECURITY INVOKER (RLS vale), só o Vault usa SECURITY DEFINER.
-- Nomes de colunas novas seguem o vocabulário do worker (apps/worker/src/validation/types.ts).

-- =========================================================
-- Colunas que o painel precisa e o schema inicial não tinha
-- =========================================================
UPDATE public.shopee_credentials
   SET status = CASE status WHEN 'pending' THEN 'pending_validation' WHEN 'valid' THEN 'validated' ELSE status END;
ALTER TABLE public.shopee_credentials DROP CONSTRAINT shopee_credentials_status_check;
ALTER TABLE public.shopee_credentials
  ALTER COLUMN status SET DEFAULT 'pending_validation',
  ADD CONSTRAINT shopee_credentials_status_check
    CHECK (status IN ('pending_validation','validated','invalid','error')),
  ADD COLUMN secret_last4 text CHECK (secret_last4 IS NULL OR char_length(secret_last4) <= 4);

-- `channels.status` continua sendo o estado operacional (active/inactive/error) que a fila lê;
-- a validação da credencial é uma coluna própria.
ALTER TABLE public.channels
  ADD COLUMN bot_name text,
  ADD COLUMN validation_status text NOT NULL DEFAULT 'pending_validation'
    CHECK (validation_status IN ('pending_validation','validated','invalid')),
  ADD COLUMN validated_at timestamptz,
  ADD COLUMN last_error text;

ALTER TABLE public.groups
  ADD COLUMN chat_type text NOT NULL DEFAULT 'group' CHECK (chat_type IN ('group','supergroup','channel')),
  ADD COLUMN members integer NOT NULL DEFAULT 0 CHECK (members >= 0);

ALTER TABLE public.automations ADD COLUMN name text NOT NULL DEFAULT '' CHECK (char_length(name) <= 120);

-- Origem do envio como texto gravado no momento (sem FK: apagar a automação não pode tocar o histórico imutável).
ALTER TABLE public.sends ADD COLUMN automation_name text;

-- =========================================================
-- Conta da sessão
-- =========================================================
CREATE FUNCTION public.web_account()
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_acc uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- duas primeiras requisições simultâneas do mesmo usuário não criam duas contas
  PERFORM pg_advisory_xact_lock(hashtext('achadinhos.web_account'), hashtext(v_uid::text));
  SELECT account_id INTO v_acc FROM public.accounts
   WHERE user_id = v_uid ORDER BY created_at, account_id LIMIT 1;
  IF v_acc IS NULL THEN
    INSERT INTO public.accounts (user_id) VALUES (v_uid) RETURNING account_id INTO v_acc;
  END IF;
  RETURN v_acc;
END $$;

CREATE FUNCTION public.web_account_timezone()
RETURNS text LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT a.timezone FROM public.accounts a WHERE a.account_id = public.web_account()
$$;

-- =========================================================
-- Vault write-only
-- =========================================================
-- Grava e devolve só o id. Não existe RPC de leitura: quem lê é o worker (service_role).
CREATE FUNCTION public.web_put_secret(p_kind text, p_value text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_acc uuid := public.web_account();
BEGIN
  IF p_kind NOT IN ('shopee_secret', 'telegram_token') THEN
    RAISE EXCEPTION 'invalid_kind' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_value IS NULL OR btrim(p_value) = '' OR char_length(p_value) > 512 THEN
    RAISE EXCEPTION 'invalid_secret' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN vault.create_secret(
    p_value,
    'achadinhos/' || v_acc::text || '/' || p_kind || '/' || gen_random_uuid()::text,
    p_kind);
END $$;

-- O id só vale se o segredo foi criado por esta conta e para este uso (o nome carrega os dois).
CREATE FUNCTION public.web_secret_belongs(p_secret_id uuid, p_account uuid, p_kind text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM vault.secrets s
     WHERE s.id = p_secret_id
       AND s.name LIKE 'achadinhos/' || p_account::text || '/' || p_kind || '/%')
$$;

CREATE FUNCTION public.web_get_shopee()
RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT to_jsonb(r) FROM (
    SELECT c.app_id, c.secret_id, coalesce(c.secret_last4, '') AS secret_last4,
           c.status, c.validated_at, c.last_error
      FROM public.shopee_credentials c
     WHERE c.account_id = public.web_account()) r
$$;

CREATE FUNCTION public.web_save_shopee(p_app_id text, p_secret_id uuid, p_last4 text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_acc uuid := public.web_account();
  v_old uuid;
BEGIN
  IF p_app_id IS NULL OR p_app_id !~ '^\d{6,20}$' THEN
    RAISE EXCEPTION 'invalid_app_id' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF NOT public.web_secret_belongs(p_secret_id, v_acc, 'shopee_secret') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT secret_id INTO v_old FROM public.shopee_credentials WHERE account_id = v_acc;
  -- pedir nova validação = pending_validation sem erro (contrato do worker)
  INSERT INTO public.shopee_credentials (account_id, app_id, secret_id, secret_last4, status, validated_at, last_error)
  VALUES (v_acc, p_app_id, p_secret_id, left(p_last4, 4), 'pending_validation', NULL, NULL)
  ON CONFLICT (account_id) DO UPDATE
    SET app_id = EXCLUDED.app_id, secret_id = EXCLUDED.secret_id, secret_last4 = EXCLUDED.secret_last4,
        status = 'pending_validation', validated_at = NULL, last_error = NULL;
  IF v_old IS NOT NULL AND v_old <> p_secret_id THEN
    DELETE FROM vault.secrets WHERE id = v_old; -- o segredo substituído não fica órfão
  END IF;
  RETURN public.web_get_shopee();
END $$;

CREATE FUNCTION public.web_get_channel()
RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT to_jsonb(r) FROM (
    SELECT c.config_secret_id AS secret_id, coalesce(c.bot_name, '') AS bot_name,
           c.validation_status AS status, c.validated_at, c.last_error
      FROM public.channels c
     WHERE c.account_id = public.web_account() AND c.kind = 'telegram'
     ORDER BY c.created_at, c.id LIMIT 1) r
$$;

CREATE FUNCTION public.web_save_channel(p_secret_id uuid, p_bot_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_acc uuid := public.web_account();
  v_ch  uuid;
  v_old uuid;
BEGIN
  IF NOT public.web_secret_belongs(p_secret_id, v_acc, 'telegram_token') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT id, config_secret_id INTO v_ch, v_old FROM public.channels
   WHERE account_id = v_acc AND kind = 'telegram' ORDER BY created_at, id LIMIT 1 FOR UPDATE;
  IF v_ch IS NULL THEN
    INSERT INTO public.channels (account_id, kind, config_secret_id, bot_name)
    VALUES (v_acc, 'telegram', p_secret_id, left(p_bot_name, 120));
  ELSE
    UPDATE public.channels
       SET config_secret_id = p_secret_id, bot_name = left(p_bot_name, 120),
           validation_status = 'pending_validation', validated_at = NULL, last_error = NULL
     WHERE id = v_ch;
    IF v_old <> p_secret_id THEN
      DELETE FROM vault.secrets WHERE id = v_old;
    END IF;
  END IF;
  RETURN public.web_get_channel();
END $$;

-- =========================================================
-- Grupos
-- =========================================================
CREATE FUNCTION public.web_list_groups()
RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.created_at, r.id), '[]'::jsonb) FROM (
    SELECT g.id, g.external_id AS chat_id, coalesce(g.name, '') AS name, g.chat_type, g.sub_id,
           g.active, g.members, g.created_at
      FROM public.groups g
     WHERE g.account_id = public.web_account()) r
$$;

-- Insere grupos novos (inativos, sub_id novo) e atualiza nome/membros dos existentes; sub_id e active ficam.
CREATE FUNCTION public.web_sync_groups(p_found jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_acc  uuid := public.web_account();
  v_ch   uuid;
  v_item jsonb;
  v_n    integer;
  v_sub  text;
  v_tail text;
BEGIN
  IF jsonb_typeof(p_found) <> 'array' OR jsonb_array_length(p_found) > 500 THEN
    RAISE EXCEPTION 'invalid_groups' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT id INTO v_ch FROM public.channels
   WHERE account_id = v_acc AND kind = 'telegram' ORDER BY created_at, id LIMIT 1;
  IF v_ch IS NULL THEN
    RAISE EXCEPTION 'no_channel' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM 1 FROM public.accounts WHERE account_id = v_acc FOR UPDATE; -- serializa a geração de sub_id
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_found) LOOP
    IF v_item->>'chatType' NOT IN ('group','supergroup','channel') OR coalesce(v_item->>'chatId', '') = '' THEN
      RAISE EXCEPTION 'invalid_groups' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    UPDATE public.groups
       SET name = left(v_item->>'name', 200), members = greatest(0, coalesce((v_item->>'members')::integer, 0)),
           chat_type = v_item->>'chatType'
     WHERE channel_id = v_ch AND external_id = v_item->>'chatId';
    IF NOT FOUND THEN
      SELECT count(*) INTO v_n FROM public.groups WHERE account_id = v_acc;
      v_tail := coalesce(nullif(right(regexp_replace(v_item->>'chatId', '\D', '', 'g'), 4), ''), 'x');
      LOOP
        v_n := v_n + 1;
        v_sub := 'tg-' || lpad(v_n::text, 2, '0') || '-' || v_tail;
        EXIT WHEN NOT EXISTS (SELECT 1 FROM public.groups WHERE account_id = v_acc AND sub_id = v_sub);
      END LOOP;
      INSERT INTO public.groups (account_id, channel_id, external_id, name, sub_id, active, chat_type, members)
      VALUES (v_acc, v_ch, v_item->>'chatId', left(v_item->>'name', 200), v_sub, false,
              v_item->>'chatType', greatest(0, coalesce((v_item->>'members')::integer, 0)));
    END IF;
  END LOOP;
  RETURN public.web_list_groups();
END $$;

CREATE FUNCTION public.web_set_group_active(p_group_id uuid, p_active boolean)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_acc uuid := public.web_account();
  v_id  uuid;
BEGIN
  UPDATE public.groups SET active = p_active
   WHERE id = p_group_id AND account_id = v_acc RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN (SELECT g FROM jsonb_array_elements(public.web_list_groups()) g WHERE g->>'id' = v_id::text);
END $$;

-- =========================================================
-- Automações
-- =========================================================
CREATE FUNCTION public.web_list_automations(p_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.created_at, r.id), '[]'::jsonb) FROM (
    SELECT a.id, a.name, a.status, a.filters, a.days,
           to_char(a.window_start, 'HH24:MI') AS window_start, to_char(a.window_end, 'HH24:MI') AS window_end,
           a.frequency_min, a.header, a.footer, a.created_at,
           coalesce((SELECT jsonb_agg(ag.group_id::text ORDER BY ag.group_id)
                       FROM public.automation_groups ag
                      WHERE ag.account_id = a.account_id AND ag.automation_id = a.id), '[]'::jsonb) AS group_ids
      FROM public.automations a
     WHERE a.account_id = public.web_account() AND (p_id IS NULL OR a.id = p_id)) r
$$;

CREATE FUNCTION public.web_create_automation(p_draft jsonb, p_max integer)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_acc uuid := public.web_account();
  v_id  uuid;
BEGIN
  -- contagem e inserção na mesma seção crítica (lock da conta)
  PERFORM 1 FROM public.accounts WHERE account_id = v_acc FOR UPDATE;
  IF (SELECT count(*) FROM public.automations WHERE account_id = v_acc) >= p_max THEN
    RAISE EXCEPTION 'automation_limit' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO public.automations
    (account_id, name, status, filters, days, window_start, window_end, frequency_min, header, footer)
  VALUES (
    v_acc, p_draft->>'name', coalesce(p_draft->>'status', 'active'), coalesce(p_draft->'filters', '{}'::jsonb),
    coalesce((SELECT array_agg(d::smallint) FROM jsonb_array_elements_text(p_draft->'days') d), ARRAY[]::smallint[]),
    (p_draft->>'windowStart')::time, (p_draft->>'windowEnd')::time, (p_draft->>'frequencyMin')::integer,
    p_draft->>'header', p_draft->>'footer')
  RETURNING id INTO v_id;
  INSERT INTO public.automation_groups (automation_id, account_id, group_id)
  SELECT DISTINCT v_id, v_acc, g::uuid FROM jsonb_array_elements_text(coalesce(p_draft->'groupIds', '[]'::jsonb)) g;
  RETURN public.web_list_automations(v_id)->0;
END $$;

CREATE FUNCTION public.web_update_automation(p_id uuid, p_draft jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_acc uuid := public.web_account();
  v_id  uuid;
BEGIN
  PERFORM 1 FROM public.accounts WHERE account_id = v_acc FOR UPDATE;
  UPDATE public.automations
     SET name = p_draft->>'name', status = coalesce(p_draft->>'status', status),
         filters = coalesce(p_draft->'filters', '{}'::jsonb),
         days = coalesce((SELECT array_agg(d::smallint) FROM jsonb_array_elements_text(p_draft->'days') d), ARRAY[]::smallint[]),
         window_start = (p_draft->>'windowStart')::time, window_end = (p_draft->>'windowEnd')::time,
         frequency_min = (p_draft->>'frequencyMin')::integer, header = p_draft->>'header', footer = p_draft->>'footer'
   WHERE id = p_id AND account_id = v_acc
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;
  DELETE FROM public.automation_groups WHERE automation_id = v_id AND account_id = v_acc;
  INSERT INTO public.automation_groups (automation_id, account_id, group_id)
  SELECT DISTINCT v_id, v_acc, g::uuid FROM jsonb_array_elements_text(coalesce(p_draft->'groupIds', '[]'::jsonb)) g;
  RETURN public.web_list_automations(v_id)->0;
END $$;

CREATE FUNCTION public.web_remove_automation(p_id uuid)
RETURNS boolean LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_n integer;
BEGIN
  DELETE FROM public.automations WHERE id = p_id AND account_id = public.web_account();
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
END $$;

-- =========================================================
-- Ofertas, Mandar agora e Envios
-- =========================================================
CREATE FUNCTION public.web_save_offer(p_offer jsonb)
RETURNS uuid LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_acc   uuid := public.web_account();
  v_price numeric := (p_offer->>'price')::numeric;
  v_old   numeric := (p_offer->>'oldPrice')::numeric;
  v_id    uuid;
BEGIN
  IF coalesce(p_offer->>'itemId', '') = '' OR char_length(p_offer->>'itemId') > 64 THEN
    RAISE EXCEPTION 'invalid_offer' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  INSERT INTO public.offers
    (account_id, item_id, title, price, original_price, discount_pct, commission_rate, rating, sales,
     image_url, product_url, raw, fetched_at)
  VALUES (
    v_acc, p_offer->>'itemId', left(p_offer->>'title', 300), v_price, v_old,
    CASE WHEN v_old > 0 THEN round((1 - v_price / v_old) * 100, 2) END,
    (p_offer->>'commissionRate')::numeric, (p_offer->>'rating')::numeric, (p_offer->>'sales')::numeric::integer,
    p_offer->>'imageUrl', p_offer->>'productLink',
    jsonb_build_object('offerLink', p_offer->>'offerLink', 'shopName', p_offer->>'shopName',
                       'placeholderHue', p_offer->'placeholderHue'),
    now())
  ON CONFLICT (account_id, item_id) DO UPDATE
    SET title = EXCLUDED.title, price = EXCLUDED.price, original_price = EXCLUDED.original_price,
        discount_pct = EXCLUDED.discount_pct, commission_rate = EXCLUDED.commission_rate,
        rating = EXCLUDED.rating, sales = EXCLUDED.sales, image_url = EXCLUDED.image_url,
        product_url = EXCLUDED.product_url, raw = EXCLUDED.raw, fetched_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE FUNCTION public.web_list_offers()
RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.fetched_at DESC, r.id), '[]'::jsonb) FROM (
    SELECT o.id, o.item_id, o.title, o.price, o.original_price, o.commission_rate, o.rating, o.sales,
           o.image_url, o.product_url, o.raw, o.fetched_at
      FROM public.offers o
     WHERE o.account_id = public.web_account()
     ORDER BY o.fetched_at DESC, o.id LIMIT 50) r
$$;

-- Envolve enqueue_send_now (única porta de entrada na fila) e informa se o clique caiu em um envio já existente.
CREATE FUNCTION public.web_enqueue_send_now(p_group_id uuid, p_offer_id uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_id  uuid;
  v_dup boolean;
BEGIN
  v_id := public.enqueue_send_now(p_group_id, p_offer_id);
  -- linha criada nesta transação tem created_at = now(); uma anterior é duplicata
  SELECT s.created_at < now() INTO v_dup FROM public.sends s WHERE s.id = v_id;
  RETURN jsonb_build_object('send_id', v_id, 'duplicate', coalesce(v_dup, false));
END $$;

CREATE FUNCTION public.web_recent_sent(p_item_id text, p_group_ids jsonb, p_since timestamptz)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('group_id', s.group_id, 'at', s.sent_at) ORDER BY s.sent_at DESC), '[]'::jsonb)
    FROM public.sends s
    JOIN public.offers o ON o.account_id = s.account_id AND o.id = s.offer_id
   WHERE s.account_id = public.web_account()
     AND o.item_id = p_item_id AND s.status = 'sent' AND s.sent_at >= p_since
     AND s.group_id::text IN (SELECT jsonb_array_elements_text(p_group_ids))
$$;

CREATE FUNCTION public.web_list_sends(p_since timestamptz)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.at DESC, r.id), '[]'::jsonb) FROM (
    SELECT s.id, s.status, s.reason, s.priority, s.group_id,
           coalesce(s.scheduled_for, s.created_at) AS scheduled_for, s.sent_at,
           coalesce(s.sent_at, s.scheduled_for, s.created_at) AS at,
           o.title AS offer_title, g.name AS group_name, s.automation_name, s.short_link
      FROM public.sends s
      LEFT JOIN public.offers o ON o.account_id = s.account_id AND o.id = s.offer_id
      LEFT JOIN public.groups g ON g.account_id = s.account_id AND g.id = s.group_id
     WHERE s.account_id = public.web_account()
       AND (s.status IN ('queued', 'sending') OR coalesce(s.sent_at, s.scheduled_for, s.created_at) >= p_since)
     ORDER BY coalesce(s.sent_at, s.scheduled_for, s.created_at) DESC, s.id
     LIMIT 1000) r
$$;

-- =========================================================
-- Privilégios: só authenticated executa; anon e service_role não
-- =========================================================
DO $$
DECLARE
  f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname LIKE 'web\_%'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, service_role', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.sig);
  END LOOP;
END $$;
-- helper de posse do segredo é interno: nem authenticated chama direto
REVOKE ALL ON FUNCTION public.web_secret_belongs(uuid, uuid, text) FROM authenticated;
