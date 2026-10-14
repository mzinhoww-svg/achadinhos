-- achadinhos: T7-12 — leitura de segredo do Vault pelo worker (decisão 003 H1/H3)
-- O worker (service_role) lê o segredo por esta RPC, sem depender de GRANT no schema vault.
-- Só devolve o texto; nunca registra, nunca expõe a anon/authenticated.
CREATE FUNCTION public.worker_read_secret(p_secret_id uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- plpgsql: a view do Vault só é resolvida na chamada (não acopla a criação ao schema vault)
  RETURN (SELECT ds.decrypted_secret FROM vault.decrypted_secrets ds WHERE ds.id = p_secret_id);
END $$;

REVOKE ALL ON FUNCTION public.worker_read_secret(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.worker_read_secret(uuid) TO service_role;
