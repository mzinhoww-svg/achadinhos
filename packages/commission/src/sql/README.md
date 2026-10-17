# DORMENTE

DORMENTE: ver docs/plans/escopo-sem-supabase-telegram.md

O adaptador SQL de comissões (`sql-repository.ts`) está dormente: a coleta a cada 6 h é
adiada (§4 do plano) e sai da CI padrão (`exclude` no `tsconfig.json`/`vitest.config.ts` do
pacote). **Não apagar**: a revalidação roda no workflow `.github/workflows/dormente.yml`
(`tsconfig.dormente.json`/`vitest.dormente.config.ts`). O núcleo puro do pacote continua ativo.

Observação para o Planejador: `src/index.ts` reexporta `./sql/sql-repository.js`, então o
arquivo ainda entra no programa do `typecheck` via o barrel (o `exclude` retira o teste e o
harness do `sql/`, não o módulo reexportado). Ver o aviso no PR da T7-C.
