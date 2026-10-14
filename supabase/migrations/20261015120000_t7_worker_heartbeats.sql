-- achadinhos: T7-14 — heartbeat do worker exposto no banco (decisão 003, H5)
-- O worker grava um batimento por tick bem-sucedido; o monitor de alertas lê a idade.
-- Tempo sempre pelo relógio do banco (worker e monitor podem ter relógios diferentes).

CREATE TABLE public.worker_heartbeats (
  worker_id  text PRIMARY KEY CHECK (length(worker_id) BETWEEN 1 AND 100),
  started_at timestamptz NOT NULL DEFAULT now(),
  beat_at    timestamptz NOT NULL DEFAULT now(),
  tick_count bigint NOT NULL DEFAULT 1 CHECK (tick_count >= 1)
);

-- RLS ligada e sem policy: só o role dono/service_role (BYPASSRLS) acessa a tabela.
ALTER TABLE public.worker_heartbeats ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.worker_heartbeats FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.record_worker_heartbeat(p_worker_id text)
RETURNS timestamptz
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  INSERT INTO public.worker_heartbeats AS h (worker_id, started_at, beat_at, tick_count)
  VALUES (p_worker_id, now(), now(), 1)
  ON CONFLICT (worker_id)
  DO UPDATE SET beat_at = now(), tick_count = h.tick_count + 1
  RETURNING beat_at;
$$;

-- Idade (ms) do batimento mais recente entre todos os workers (deploy sobreposto é
-- seguro, decisão 003 H5). NULL = nunca houve batimento.
CREATE FUNCTION public.worker_heartbeat_age_ms()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT floor(extract(epoch FROM (now() - max(beat_at))) * 1000)::bigint
    FROM public.worker_heartbeats;
$$;

REVOKE ALL ON FUNCTION public.record_worker_heartbeat(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.worker_heartbeat_age_ms() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_worker_heartbeat(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.worker_heartbeat_age_ms() TO service_role;
