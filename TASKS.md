# TASKS
Status: pendente | em_andamento | em_revisao | concluida | bloqueada. Evidência = PR/commit/teste.

| ID | Tarefa | Responsável | Status | Evidência |
|----|--------|-------------|--------|-----------|
| T0 | Esqueleto monorepo, CI, gitleaks, docs | Orquestrador | concluida | `ci.yml` verde na main, `.gitleaks.toml`/`.gitleaksignore`, docs e decisões (conferido pelo QA no PR #53) |
| T1 | Cliente Shopee + servidor GraphQL simulado (MVP 1) | Sextante | concluida | PR #1 e hardening #17 mergeados; vive como `packages/shopee` (ativo) |
| T2 | Schema, migrações e RLS | Cinzel | concluida (dormente) | PR #4 mergeado; schema/RLS Postgres fora do escopo atual (preservado) |
| T3 | Design system + telas base | Prisma | concluida | PR #5 mergeado |
| T4 | Bot Telegram (token, grupos, envio) | Vigia | concluida (dormente) | PR #2 mergeado; Telegram fora do escopo atual (preservado) |
| T5 | Painel de progresso 127.0.0.1:3300 | Bússola | não verificado | sem evidência no repositório (nenhuma referência à porta 3300; nada respondeu em 127.0.0.1:3300 na conferência do QA) |
| T9 | Comissão: conversionReport a cada 6 h idempotente (packages/commission) | Balanço | concluida (núcleo puro) | PR #9 mergeado; coletor de `conversionReport` idempotente. O job de 6 h não está ligado e a comissão está adiada (item 12) |
| T6 | packages/domain: estimativa, janela/fuso, filtros, antirrepetição (MVP 4–7 parte pura) | Compasso | concluida | PR #7 e #12 mergeados; `packages/domain` (ativo: fuso e filtros) |
| T10 | Alertas por e-mail (MVP 13) | Sentinela | concluida (dormente) | PR #8 mergeado; alertas por e-mail fora do escopo atual (preservado) |
| T7-A | packages/channel: interface Channel + adaptador FileOutbox | Cinzel | concluida | PR #45 (via #49) na main; 75 testes de `packages/channel` |
| T7-C | Isolar o código dormente (exclude tsconfig/vitest, filtros pnpm, configs e workflow dormentes, READMEs, avisos) | Vigia | concluida | PR #46 (via #43/#49) na main; worker ativo separado da suíte dormente; workflow `dormente.yml` |
| T7-B | packages/worker: gerador + CLI `pnpm outbox:gerar` (Channel FileOutbox) | Cinzel | concluida | PR #50 na main; CLI `outbox:gerar` com guarda `--permitir-real`; testes com portas injetadas (falta e2e contra a Shopee simulada, ver E2E-1) |
| T11 | Sonda real da credencial Shopee (MVP 2 e 10): script + 1 chamada somente-leitura | Sextante | concluida (resultado: credencial NÃO validada) | PR #41 na main; sonda real = HTTP 2xx + erro `10010`, contagem 0 |
| T12 | Diagnóstico do 10010: modo de diagnóstico em scripts/ + degrau D0 | Sextante | em_andamento | D0 feito (PR #44 via #49): OK, não prova credencial. Faltam D1 e D4 (autorização de Aurimar); depois corrigir o documento `productOfferV2` no cliente |
| T8-A | Desacoplar o web: só container em memória; /conexoes e Telegram atrás de flag (sem Supabase/Telegram/Vault ativos) | Vigia | concluida | PR #51 na main; painel só em memória, demo local; build e testes sem env do Supabase |
| T7-LEG | Legado: worker e fila Postgres (T7-01..T7-14) e web Supabase (T8-01..T8-11) | vários | concluida (dormente) | PRs #11 a #39 mergeados; preservados e isolados pelo escopo novo (T7-C), revalidados no workflow dormente |
| T12-D1D4 | Diagnóstico do `10010`: D1 (`productOfferV2` inline, 2 campos) e D4 (Secret sentinela inválido) | Sextante | bloqueada | aguarda autorização de Aurimar com número exato de chamadas; D4 com autorização própria |
| T12-FIX | Corrigir o documento `productOfferV2` no `ShopeeClient` conforme a causa achada; estado de conexão "formato recusado" na 004 | Sextante | pendente | depende de T12-D1D4; teste novo por correção contra o servidor simulado atualizado |
| T7-D | Automações lidas de arquivo de configuração só-leitura (limite 5, filtros) | Cinzel | concluida | PR #54 na main; `config/automacoes.json` só-leitura (limite 5, filtros, palavra-chave), agenda sem estado (janela+dias), `chamadas_max = vencidas × (páginas + limite)`; domain 59 e worker 147 testes reportados no PR (recontar no próximo gate). Falta o arquivo real de Aurimar e o E2E-1 |
| T8-B | "Mandar agora" do web chama o gerador (opcional) | a definir | bloqueada | aguarda resposta 2 de Aurimar (o web continua?); exige sessão além do demo local |
| E2E-1 | E2E do CLI real (`makeRealWiring`) contra `startMockShopeeServer` + FileOutbox + render real: N ofertas → N pares `.md`/`.png` + `index.md`; mesma execução no mesmo minuto não duplica; exit codes | a definir | pendente | item 10 do checklist; não existe hoje |
| DOC-1 | README do CLI reproduzível do zero (clonar → instalar → rodar contra o simulado → ver a pasta) | a definir | pendente | item 14 do checklist |
| WA-1 | Canal WhatsApp (mesma interface `Channel`) | a definir | adiada | gate: reabrir antirrepetição e limite de ritmo, aprovação do primeiro envio real a grupo com outros membros, decisão do transporte (termos/risco de banimento; resposta 4) |
