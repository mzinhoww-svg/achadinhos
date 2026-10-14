# Plano — Fase 1: Fundação (checklist F1)

Autor: Farol (Planejador) · 2026-10-13 · Base: `docs/prd.md`, `docs/mvp-checklist.json`, decisões 001–004.
Cobre os itens **1, 2 e 3** do `mvp-checklist.json` (fase F1) e os pré-requisitos técnicos deles (T1, T2, T4 do `TASKS.md`).
Status de execução vive em `TASKS.md`; este arquivo define escopo, dependências e aceite.

## Objetivo
Ter o alicerce verificável: cliente Shopee assinado e testado contra GraphQL simulado, schema com RLS, segredos no Vault com o fluxo write-only da decisão 003 (H1) e um canal Telegram ativo com grupo de teste. Nada de fila nem agendador aqui.

## Dependências externas (ver `docs/ACTIONS.md`)
| Dependência | Bloqueia | Sem ela |
|---|---|---|
| App ID/Secret Shopee | F1-02 (parte real), F1-05 | Tudo roda contra o servidor simulado; itens 1 e 2 ficam "aguardando credencial" só no teste de integração real |
| Projeto Supabase | F1-03, F1-04, F1-05, F1-06 | Migrações testadas em Postgres local (supabase CLI/Docker) |
| Token do bot + grupo de teste | F1-06 | Cliente Telegram testado com servidor simulado |
| Confirmação do endpoint (decisão 004) | F1-02 | Endpoint configurável via `SHOPEE_ENDPOINT` |

## Tarefas
| ID | Tarefa | Item MVP | Depende de | Responsável sugerido |
|---|---|---|---|---|
| F1-01 | Servidor GraphQL simulado da Shopee (productOfferV2, generateShortLink, conversionReport, erros de assinatura/rate limit) em `packages/shopee`, com fixtures | 1 | T0 | Dev |
| F1-02 | Cliente Shopee: assinatura `SHA256(AppID+timestamp+payload+Secret)` sobre **a mesma string do corpo enviado**, timeout, erro tipado, validação de schema da resposta (falha fechada), sem log de header/segredo. Registrar endpoint e formato de erro na decisão 004 | 1 | F1-01 | Dev |
| F1-03 | Schema + migrações (tabelas do PRD, `account_id` em todas, índices parciais da fila e dedupe, `idempotency_key`, `lease_expires_at`, `attempted_at`, unique parcial `sending` por canal conforme decisão 001) | pré-req de 2, 3 e F2 | T0 | Dev (T2) |
| F1-04 | RLS por conta em todas as tabelas, sem policy de DELETE em `sends`/`commissions`, views com `security_invoker`, funções `SECURITY DEFINER` com `search_path` fixo; testes de RLS (usuário A não vê/escreve dados da conta B) | pré-req de 2 | F1-03 | Dev (T2) + Farol audita |
| F1-05 | Conexões Shopee: tela, Server Action write-only (grava no Vault por RPC), `status` pending_validation → validated/invalid, worker valida lendo do Vault; painel exibe só status/`last_error` saneado/`validated_at` | 2 | F1-02, F1-04 | Dev + Designer |
| F1-06 | Canal Telegram: token via mesmo fluxo write-only, descoberta de grupos pelo worker, ativar/desativar grupo, `sub_id` único por grupo (unique por conta), mensagem de verificação | 3 | F1-04 | Dev (T4) |
| F1-07 | Auth e sessão do painel (Supabase Auth), checagem de sessão em **cada** Server Action/route (não só middleware), layout base | pré-req de 2, 3 | F1-04 | Dev + Designer (T3) |
| F1-08 | Worker esqueleto: carga de config, logger com redação de segredos, laço de tarefas pendentes (5–10 s) separado do tick | 2, 3 | F1-03 | Dev |
| F1-09 | Auditoria de F1 contra `docs/security-checklist.md` (seções A, B, C) | 2 | F1-05, F1-06 | Farol |

## Ordem sugerida
`F1-01 → F1-02` e `F1-03 → F1-04` em paralelo; depois `F1-07/F1-08`; depois `F1-05` e `F1-06` em paralelo; por fim `F1-09`.

## Critérios de aceite
Todos devem passar para a F1 fechar. A ligação com o checklist está na coluna "Item".

| # | Item | Critério (do checklist) | Evidência exigida |
|---|---|---|---|
| 1 | Cliente Shopee assinado | Testes unitários com vetor conhecido + teste contra GraphQL simulado | Teste com vetor fixo de assinatura (App ID, timestamp, payload, secret de teste, hash esperado); teste que altera 1 byte do corpo e assinatura deixa de bater; resposta malformada ⇒ erro, nunca dado parcial |
| 2 | Conexões / Vault | Nenhuma rota ou payload RSC contém o Secret | Teste automatizado que busca o valor do secret de teste em: respostas HTTP de todas as rotas, payload RSC (`text/x-component`), retorno de Server Actions, HTML, logs do worker. Zero ocorrências. `select` em `shopee_credentials` nunca traz coluna de secret (só `secret_id`) |
| 3 | Canal Telegram | Grupo de teste aparece e recebe mensagem de verificação | Com token real: grupo listado na tela e mensagem recebida (print/ID da mensagem). Sem token: mesmo fluxo contra servidor simulado + fica "aguardando credencial" |

Critérios transversais da fase:
- `pnpm typecheck` e `pnpm test` verdes; gitleaks verde; nenhum segredo em log, PR ou fixture.
- Teste de RLS cruzado entre duas contas passa em todas as tabelas.
- Auditoria F1-09 sem item crítico aberto.

## Riscos da fase
| Risco | Mitigação |
|---|---|
| Doc oficial da Shopee diverge do presumido (endpoint, formato de erro) | Decisão 004 é a fonte; cliente isola isso numa camada fina |
| Credencial demora | Servidor simulado cobre desenvolvimento; só o teste real fica pendente |
| Fluxo write-only complica a UI (usuário não vê o secret depois) | Mostrar "configurado em dd/mm" e botão "substituir"; é o comportamento desejado |
