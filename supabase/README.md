# DORMENTE

DORMENTE: ver docs/plans/escopo-sem-supabase-telegram.md

As migrações e os testes de banco (`supabase/migrations`, `supabase/tests`) ficam intactos,
mas o job de banco sai da CI padrão. **Não apagar**: `supabase test db --local` roda no
workflow dormente `.github/workflows/dormente.yml`.

O escopo novo não guarda nada (sem banco, sem Vault, sem RLS, sem Realtime).
