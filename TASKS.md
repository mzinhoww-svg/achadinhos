# TASKS
Status: pendente | em_andamento | em_revisao | concluida | bloqueada. Evidência = PR/commit/teste.

| ID | Tarefa | Responsável | Status | Evidência |
|----|--------|-------------|--------|-----------|
| T0 | Esqueleto monorepo, CI, gitleaks, docs | Orquestrador | em_revisao | commit inicial |
| T1 | Cliente Shopee + servidor GraphQL simulado (MVP 1) | Sextante | em_revisao | PR #1 aprovado por QA e Farol; resolvendo conflito; depois T1b (R1–R5) |
| T2 | Schema, migrações e RLS | Cinzel | em_revisao | PR #4 aprovado pelo QA; auditoria Farol |
| T3 | Design system + telas base | Prisma | concluida | PR #5 mergeado |
| T4 | Bot Telegram (token, grupos, envio) | Vigia | devolvido (ciclo 2) | PR #2; 1 bloqueante restante: chat_member com getMe falho |
| T5 | Painel de progresso 127.0.0.1:3300 | Bússola | em_andamento | servidor no ar |
| T9 | Comissão: conversionReport a cada 6 h idempotente (packages/commission) | Balanço | concluida | PR #9 mergeado |
| T6 | packages/domain: estimativa, janela/fuso, filtros, antirrepetição (MVP 4–7 parte pura) | Compasso | em_revisao | PR #7 aprovado pelo QA; auditoria Farol |
| T10 | Alertas por e-mail (MVP 13) | Sentinela | em_revisao | PR #8 aprovado pelo QA; auditoria Farol |
| T7-A | packages/channel: interface Channel + adaptador FileOutbox | Cinzel | em_revisao | PR #45; `pnpm test` (75 testes) + `pnpm typecheck` verdes |
| T7-C | Isolar o código dormente (exclude tsconfig/vitest, filtros pnpm, configs e workflow dormentes, READMEs, avisos) | Vigia | em_revisao | PR #46; worker: 87 ativos + 261 dormentes = 339 (+9 novos); typecheck/test verdes; workflow dormente |
| T7-B | packages/worker: gerador + CLI `pnpm outbox:gerar` (Channel FileOutbox) | Cinzel | em_revisao | PR #50; worker 134 testes (+47) e typecheck verdes; e2e com Shopee simulada |
| T11 | Sonda real da credencial Shopee (MVP 2 e 10): script + 1 chamada somente-leitura | Sextante | em_revisao | PR #41 (main #42/#43/#49 trazida por merge, conflitos resolvidos); 57 testes do pacote ok; sonda real = falha/10010/0 |
| T12 | Diagnóstico do 10010: modo de diagnóstico em scripts/ + degrau D0 | Sextante | em_revisao | PR #44 (na main via #49); D0 = OK/contagem 1; sem D1 |
| T7-D | Automações por arquivo (`config/automacoes.json`, limite 5) + agendamento sobre o gerador | Cinzel | em_revisao | PR #54; domain 59 e worker 147 testes; arquivo inválido e 6ª automação recusados; chamadas_max por vencidas |
| T8-A | Desacoplar o web: só container em memória; /conexoes e Telegram atrás de flag (sem Supabase/Telegram/Vault ativos) | Vigia | em_revisao | PR #51; build e testes verdes sem env do Supabase |
