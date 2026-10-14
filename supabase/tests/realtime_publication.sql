CREATE EXTENSION IF NOT EXISTS pgtap;

BEGIN;

SELECT plan(3);

SELECT ok(
  EXISTS (SELECT 1 FROM pg_publication_tables
           WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'sends'),
  'public.sends está publicada no supabase_realtime'
);

SELECT ok(
  (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.sends'::regclass),
  'public.sends publicada tem RLS ativo e forçado'
);

SELECT ok(
  NOT EXISTS (SELECT 1 FROM pg_publication_tables
               WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename <> 'sends'),
  'nenhuma outra tabela de public é publicada no Realtime'
);

SELECT * FROM finish();
ROLLBACK;
