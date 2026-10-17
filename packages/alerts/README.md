# DORMENTE

DORMENTE: ver docs/plans/escopo-sem-supabase-telegram.md

Este pacote (alertas por e-mail) está fora do caminho de execução e da CI padrão
(o `test`/`typecheck` da raiz usam `--filter '!@achadinhos/alerts'`). **Não apagar**: as
dependências permanecem no `package.json` e a revalidação roda no workflow
`.github/workflows/dormente.yml`. O escopo novo usa resumo no terminal e código de saída.

Não importar nada daqui no caminho ativo (worker/gerador/CLI).
