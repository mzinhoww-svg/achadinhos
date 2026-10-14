-- Item 12: persistencia de comissoes (insert-only, idempotente por (account_id, checkout_id)),
-- historico de status e soma por sub_id (grupo) para o Painel.
--
-- Decisao (M6 do review do #4): `commissions` continua so de insercao e guarda a PRIMEIRA
-- observacao do checkout. Toda mudanca de status/valor vira uma linha em `commission_events`
-- (tambem so de insercao); o estado corrente e o ultimo evento (view `commission_current`).

CREATE TABLE public.commission_events (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id uuid NOT NULL,
  checkout_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','confirmed','paid','cancelled')),
  estimated_commission numeric NOT NULL CHECK (estimated_commission >= 0),
  observed_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (account_id, checkout_id)
    REFERENCES public.commissions (account_id, checkout_id) ON DELETE CASCADE
);

CREATE INDEX commission_events_latest_idx
  ON public.commission_events (account_id, checkout_id, seq DESC);

CREATE TRIGGER commission_events_immutable_update
  BEFORE UPDATE ON public.commission_events
  FOR EACH ROW EXECUTE FUNCTION public.immutable_guard();
CREATE TRIGGER commission_events_immutable_delete
  BEFORE DELETE ON public.commission_events
  FOR EACH ROW EXECUTE FUNCTION public.immutable_guard();

ALTER TABLE public.commission_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commission_events FORCE ROW LEVEL SECURITY;
CREATE POLICY commission_events_select ON public.commission_events FOR SELECT TO authenticated
  USING (account_id IN (SELECT account_id FROM public.accounts WHERE user_id = auth.uid()));
REVOKE ALL ON public.commission_events FROM anon, authenticated;
GRANT SELECT ON public.commission_events TO authenticated;
GRANT ALL ON public.commission_events TO service_role;

-- Cursor da coleta (estado do job, nao historico): ultimo fim de janela coletado por conta.
CREATE TABLE public.commission_checkpoints (
  account_id uuid PRIMARY KEY REFERENCES public.accounts (account_id) ON DELETE CASCADE,
  last_collected_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.commission_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commission_checkpoints FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.commission_checkpoints FROM anon, authenticated;
GRANT ALL ON public.commission_checkpoints TO service_role;

-- Estado corrente de cada checkout (ultimo evento). Respeita o RLS de quem consulta.
CREATE VIEW public.commission_current WITH (security_invoker = true) AS
SELECT c.account_id,
       c.checkout_id,
       c.sub_ids,
       c.purchase_time,
       e.status,
       e.estimated_commission,
       e.observed_at AS updated_at
  FROM public.commissions c
  JOIN LATERAL (
    SELECT status, estimated_commission, observed_at
      FROM public.commission_events
     WHERE account_id = c.account_id AND checkout_id = c.checkout_id
     ORDER BY seq DESC
     LIMIT 1
  ) e ON true;
GRANT SELECT ON public.commission_current TO authenticated, service_role;

-- Registro idempotente. Transicoes monotonicas (pending -> confirmed -> paid; cancelled e
-- terminal): dado antigo/fora de ordem nao reverte o estado. Serializa por checkout.
CREATE FUNCTION public.record_commission(
  p_account_id uuid,
  p_checkout_id text,
  p_sub_ids text[],
  p_purchase_time timestamptz,
  p_estimated numeric,
  p_status text
) RETURNS TABLE (outcome text, previous_status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_rows integer;
  v_status text;
  v_value numeric;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_account_id::text || ':' || p_checkout_id, 0));

  INSERT INTO public.commissions
    (account_id, checkout_id, sub_ids, purchase_time, estimated_commission, status)
  VALUES (p_account_id, p_checkout_id, p_sub_ids, p_purchase_time, p_estimated, p_status)
  ON CONFLICT (account_id, checkout_id) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 1 THEN
    INSERT INTO public.commission_events (account_id, checkout_id, status, estimated_commission)
    VALUES (p_account_id, p_checkout_id, p_status, p_estimated);
    RETURN QUERY SELECT 'inserted'::text, NULL::text;
    RETURN;
  END IF;

  SELECT e.status, e.estimated_commission INTO v_status, v_value
    FROM public.commission_events e
   WHERE e.account_id = p_account_id AND e.checkout_id = p_checkout_id
   ORDER BY e.seq DESC
   LIMIT 1;

  IF v_status = p_status AND v_value = p_estimated THEN
    RETURN QUERY SELECT 'duplicate'::text, NULL::text;
    RETURN;
  END IF;

  IF v_status = 'cancelled'
     OR (v_status <> p_status AND NOT (
          p_status = 'cancelled'
          OR (v_status = 'pending' AND p_status IN ('confirmed','paid'))
          OR (v_status = 'confirmed' AND p_status = 'paid'))) THEN
    RETURN QUERY SELECT 'duplicate'::text, NULL::text;
    RETURN;
  END IF;

  INSERT INTO public.commission_events (account_id, checkout_id, status, estimated_commission)
  VALUES (p_account_id, p_checkout_id, p_status, p_estimated);
  RETURN QUERY SELECT 'updated'::text,
                      CASE WHEN v_status <> p_status THEN v_status END;
END $$;

REVOKE ALL ON FUNCTION public.record_commission(uuid, text, text[], timestamptz, numeric, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_commission(uuid, text, text[], timestamptz, numeric, text)
  TO service_role;

-- Cursor monotonico: nunca regride.
CREATE FUNCTION public.set_commission_checkpoint(p_account_id uuid, p_at timestamptz)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.commission_checkpoints (account_id, last_collected_at)
  VALUES (p_account_id, p_at)
  ON CONFLICT (account_id) DO UPDATE
     SET last_collected_at = GREATEST(public.commission_checkpoints.last_collected_at, EXCLUDED.last_collected_at),
         updated_at = now();
$$;
REVOKE ALL ON FUNCTION public.set_commission_checkpoint(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_commission_checkpoint(uuid, timestamptz) TO service_role;

-- Painel: soma da comissao corrente por sub_id do grupo (posicao 3 de sub_ids =
-- [conta, automacao, grupo, canal, envio]); canceladas ficam fora; periodo [from, to) em UTC.
-- SECURITY INVOKER: o RLS de commissions/commission_events isola por conta.
CREATE FUNCTION public.commission_totals_by_sub_id(
  p_account_id uuid,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
) RETURNS TABLE (sub_id text, total numeric, conversions bigint)
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT cc.sub_ids[3] AS sub_id,
         sum(cc.estimated_commission) AS total,
         count(*) AS conversions
    FROM public.commission_current cc
   WHERE cc.account_id = p_account_id
     AND cc.status <> 'cancelled'
     AND cc.sub_ids[3] IS NOT NULL
     AND (p_from IS NULL OR cc.purchase_time >= p_from)
     AND (p_to IS NULL OR cc.purchase_time < p_to)
   GROUP BY cc.sub_ids[3]
   ORDER BY total DESC, sub_id;
$$;
REVOKE ALL ON FUNCTION public.commission_totals_by_sub_id(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commission_totals_by_sub_id(uuid, timestamptz, timestamptz)
  TO authenticated, service_role;
