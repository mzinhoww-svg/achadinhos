# DORMENTE

DORMENTE: ver docs/plans/escopo-sem-supabase-telegram.md

Tudo nesta pasta (Postgres/Vault: fila, cliente, stores, validação de token) está fora do
caminho ativo e da CI padrão (`exclude` em `apps/worker/tsconfig.json`). **Não apagar**: a
revalidação roda no workflow `.github/workflows/dormente.yml`
(`apps/worker/tsconfig.dormente.json`/`vitest.dormente.config.ts`).

Não importar nada daqui em módulos do caminho ativo (`offer-selection`, `deadline`,
`scheduler-ports`, `links`, `image`, `logger`, `gerar/`).
