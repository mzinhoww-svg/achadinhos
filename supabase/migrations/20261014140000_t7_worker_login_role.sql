-- achadinhos: T7-12 (QA #37, bloqueante 2) — role de LOGIN dedicada do worker (decisão 003 H3)
-- No Supabase `service_role` é NOLOGIN: a conexão direta entra como postgres/supabase_admin
-- (dono, ignora tudo). O worker passa a entrar como `achadinhos_worker`:
--   * herda os privilégios de service_role (EXECUTE nas RPCs da fila, leitura/escrita das tabelas);
--   * a sessão assume `service_role` por padrão (ALTER ROLE ... SET role) para herdar BYPASSRLS,
--     que atributo de role não herda por membership;
--   * não é superuser, não é dono de nada e tem statement_timeout próprio.
-- A SENHA não mora aqui: definir fora do repo (ALTER ROLE achadinhos_worker PASSWORD ... pelo
-- operador/Vault) antes de apontar o DATABASE_URL do worker para esta role.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'achadinhos_worker') THEN
    CREATE ROLE achadinhos_worker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE IN ROLE service_role;
  END IF;
END $$;

ALTER ROLE achadinhos_worker SET statement_timeout = '15s';
ALTER ROLE achadinhos_worker SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE achadinhos_worker SET timezone = 'UTC';
ALTER ROLE achadinhos_worker SET role = 'service_role';
