-- T8-11: publica public.sends no Realtime (postgres_changes) para o painel /envios.
-- O Realtime avalia o RLS do JWT do assinante em cada evento (sends_select + FORCE RLS):
-- a conta B nunca recebe linhas da conta A. Só `sends` entra na publicação; as demais tabelas
-- (offers, commissions, secrets...) continuam fora. Idempotente: a publicação existe no Supabase,
-- mas é criada se faltar (banco local sem o stack do Supabase).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'sends'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.sends;
  END IF;
END $$;
