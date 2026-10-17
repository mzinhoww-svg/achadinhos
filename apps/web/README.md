# apps/web — painel (demonstração local)

A T8-A desacoplou o painel do dormente: ele usa **só o container em memória** (`src/server/context.ts`),
sem Supabase, sem Telegram e sem persistência. O caminho real (Supabase Auth/RLS + Telegram) está
preservado, mas fora do caminho ativo, em `src/server/supabase/live.ts`.

## O painel só funciona como demonstração local

Sem sessão real, fora do demo `sessions.current()` devolve `null` e as telas mostram "Sessão
necessária". O jeito de usar é o modo demo:

```
pnpm --filter web dev        # roda com ACHADINHOS_DEMO_SESSION=1
```

Até a **T8-B** (ligar o "Mandar agora" ao gerador/outbox), o painel é demonstração local com dados
fictícios em memória de processo. **O deploy não está quebrado por isso**: ele apenas não tem sessão
nem dados. O demo nunca liga em produção (`VERCEL_ENV=production`/`NODE_ENV=production` sem
`ACHADINHOS_DEMO_LOCAL_BUILD=1`).

## Conexões/Telegram (dormente)

`/conexoes` é tela dormente: some do menu e responde `404`. Para reabrir localmente:

```
ACHADINHOS_CONEXOES=1 pnpm --filter web dev
```

Com a flag ligada, o item volta ao menu, a rota responde 200 e os CTAs que apontam para lá reaparecem.
