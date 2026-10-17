# DORMENTE (T8-A)

DORMENTE: ver docs/plans/escopo-sem-supabase-telegram.md

O caminho real do painel (Supabase Auth + RLS + RPC do Vault) está dormente: `apps/web` usa só o
container em memória (`../memory.ts`), sem Supabase/Telegram/Vault e sem persistência no caminho
ativo. O código continua no repositório; a costura do caminho real está em `./live.ts`.

Não importar daqui em módulos do caminho ativo (`../context.ts`). Reabrir quando a persistência
for decidida (§4 do plano). Os testes desta pasta (`apps/web/test/db/*`) continuam rodando na CI
padrão (usam pglite, sem Supabase real).
