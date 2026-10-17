# DORMENTE

DORMENTE: ver docs/plans/escopo-sem-supabase-telegram.md

Este pacote (bot do Telegram) está fora do caminho de execução e da CI padrão
(o `test`/`typecheck` da raiz usam `--filter '!@achadinhos/telegram'`). **Não apagar**: as
dependências permanecem no `package.json` e a revalidação roda no workflow
`.github/workflows/dormente.yml`. O escopo novo não usa Telegram (ver o plano).

Não importar nada daqui no caminho ativo (worker/gerador/CLI). Se um arquivo ativo
precisar deste pacote, a T7-C para e avisa o Planejador.
