# Plano — Fase 3: Worker e fila (T7) + telas operacionais (T8)

Autor: Farol (Planejador) · 2026-10-13 · Base: decisões 001–003 (pareceres), `docs/plans/fase-1-fundacao.md`, `fase-2-nucleo.md`, `docs/security-checklist.md`.
Este plano **concretiza** as fases F1/F2 do `mvp-checklist.json` em duas tarefas de `TASKS.md`: **T7** (fila + worker, itens 6, 7, 8 e consumo do criativo, item 9) e **T8** (Conexões, Automações, Mandar agora, Envios no web, itens 2, 3, 4, 5, 10, 11). Onde houver conflito, valem os requisitos A1–A9 (decisão 001) e H1–H6 (decisão 003).

## Estado dos PRs dos quais este plano depende (2026-10-13)
| PR | Tarefa | Estado | O que falta antes de ser base |
|---|---|---|---|
| #1 Cliente Shopee | T1 | QA devolveu (timeout não cobria leitura do corpo); autor reenviou ciclo 2, **aguarda revalidação** | Aprovação do QA; schema sem fail-open (strings vazias, preço negativo) recomendado |
| #2 Telegram | T4 | QA devolveu: sem timeout, `chat_member` de outro usuário desativa grupo, chat privado entra como grupo; CI `test` vermelho | Correções 1–3 + aprovação do QA; sanitizar token em `cause` |
| #4 Schema/RLS | T2 | CI `test` vermelho; **sem revisão do QA**; migração não tem `idempotency_key`, `lease_expires_at`, `attempted_at`, unique parcial de `sending` nem RPC de claim | Aprovação do QA + migração complementar (T7-01) |
| #5 Design system | T3 | QA devolveu (token na URL, criativo quebra acima de R$ 10.000) | Correções + aprovação do QA |
| #3 Docs | — | aberto | merge |

Regra deste plano: **nenhuma tarefa T7/T8 faz merge antes de seus PRs-base estarem aprovados pelo QA e auditados** (parecer do Farol em cada PR). Trabalho pode começar em paralelo sobre a branch do PR-base.

## T7 — Fila + worker
Objetivo: worker de processo único e contínuo (VPS) que agenda, enfileira e envia com 1 por canal, sem duplicata, no fuso da conta.

| ID | Tarefa | Item MVP | Depende de | Aceite resumido |
|---|---|---|---|---|
| T7-01 | Migração complementar sobre #4: `sends.idempotency_key` + unique `(account_id, idempotency_key)`; `lease_expires_at`, `attempted_at`, `finished_at`; unique parcial `(channel_id) where status='sending'`; índice `(channel_id, attempted_at)`; trigger de máquina de estados; `accounts.timezone` validado como IANA | 8 | #4 aprovado | pgTAP: 2º `sending` no canal é rejeitado; mesma chave não duplica; transição inválida recusada |
| T7-02 | RPC `claim_next_send(channel_id)` atômica (advisory lock **xact**, reaper, intervalo 60 s, teto 200/dia local, prioridade, `SKIP LOCKED`), `SECURITY DEFINER`, `search_path` fixo, `EXECUTE` só para a role do worker | 8 | T7-01 | Teste com 2 conexões concorrentes; teto no dia local de Cuiabá; relógio do banco |
| T7-03 | Reaper e `finish_send(id, status, reason, external_message_id)` | 8 | T7-02 | Crash após claim ⇒ `failed` `lease_expirado_resultado_desconhecido`; dedupe cobre o caso |
| T7-04 | Agendador de 1 min: `automation_groups` vencidos com `SKIP LOCKED`, janela/dia pelo fuso (IANA), insere `send` com `idempotency_key` de slot, avança `next_run_at` na mesma transação, não empilha | 6 | T7-01, #1 | Relógio simulado (borda, virada de dia, janela cruzando 00:00); tick duplo = 1 send |
| T7-05 | Seleção de oferta + antirrepetição 7 dias (considera `sent` e `failed` desconhecido) via `productOfferV2`, upsert em `offers` | 7 | T7-04, #1 | Reexecução 2× sem duplicata; dia 8 volta a poder enviar |
| T7-06 | Executor do envio: criativo (reuso do T3/#5), `generateShortLink` com subIds `[conta, automação, grupo, canal, envio]`, `sendPhoto` do pacote #2, erro tipado ⇒ `failed`, sem retry | 8, 9 | T7-03, #1, #2, #5 | Fluxo ponta a ponta contra Shopee/Telegram simulados |
| T7-07 | Timeouts em tudo: cada chamada externa com timeout menor que o lease (download, render, Shopee, Telegram), cobrindo a leitura do corpo | 8 | #1, #2 | Teste com corpo estancado em cada cliente; lease nunca expira em operação normal |
| T7-08 | Laço rápido (5–10 s) de tarefas pendentes: validar credencial Shopee e token/grupos Telegram lendo do Vault (decisão 003 H1) | 2, 3 | #1, #2, #4 | `pending_validation` → `validated`/`invalid` em ≤ 15 s no simulado |
| T7-09 | Heartbeat do tick, logger com redação de segredos, config via env | 13 (base) | — | Teste de redação: token e secret não aparecem em log/erro |
| T7-10 | Suíte de concorrência e fuso (2+ workers, crash, relógio do worker adiantado) | 6, 8 | T7-02..T7-06 | Critérios do item 8 do checklist |
| T7-11 | Auditoria T7 (`security-checklist.md` D, E, B) | todos | T7-10 | Parecer do Farol sem crítico aberto |

Ordem: `T7-01 → T7-02 → T7-03` ; `T7-04 → T7-05` em paralelo; `T7-06/T7-07/T7-08`; `T7-09` em qualquer ponto; `T7-10 → T7-11`.

## T8 — Web: Conexões, Automações, Mandar agora, Envios
Objetivo: telas operacionais que usam apenas anon key + sessão sob RLS, com segredo write-only.

| ID | Tarefa | Item MVP | Depende de | Aceite resumido |
|---|---|---|---|---|
| T8-01 | Auth/sessão e guarda por conta em **toda** Server Action/route (nunca só middleware); `account_id` derivado da sessão | todos | #4, #5 | Teste: action sem sessão ou com `account_id` forjado é recusada |
| T8-02 | **Conexões Shopee**: Server Action write-only (RPC grava no Vault, marca `pending_validation`); tela mostra status, `validated_at`, `last_error` saneado; "substituir" em vez de "ver" | 2 | T8-01, T7-08 | Varredura de rotas e payload RSC não contém o secret de teste |
| T8-03 | **Conexões Telegram**: token write-only, lista de grupos (só `group/supergroup/channel`), ativar/desativar, `sub_id` único, mensagem de verificação | 3 | T8-02, #2 corrigido | Grupo de teste aparece e recebe a mensagem; chat privado nunca listado |
| T8-04 | **Automações** CRUD com validação (zod) e limite de 5 imposto no banco; erro claro na 6ª | 4 | T8-01, #4 | 6ª recusada; criação concorrente não passa de 5 |
| T8-05 | **Estimativa de posts/dia** (função pura + exibição) | 5 | T8-04 | Tabela de casos da fórmula; teto 200 |
| T8-06 | **Mandar agora**: `INSERT` em `sends` por usuário sob RLS com prioridade 100 e `idempotency_key` único por clique (anti duplo clique); respeita 1-por-canal e teto | 10 | T8-01, T7-02 | E2E simulado; duplo clique = 1 envio; decisão de Aurimar sobre antirrepetição aplicada |
| T8-07 | **Envios**: cards, lista de 30 dias, Realtime (assinatura sob RLS), estados vazios | 11, 14 | T8-01, T7-06 | Status muda sem recarregar; usuário de outra conta não recebe eventos |
| T8-08 | Onboarding e estados vazios (390×844 e 1440×900) | 14 | T8-02..T8-07 | QA visual |
| T8-09 | Auditoria T8 (`security-checklist.md` A, B, C) | 2, 3, 10, 11 | T8-08 | Parecer do Farol sem crítico aberto |

Ordem: `T8-01 → T8-02 → T8-03` e `T8-04 → T8-05` em paralelo; `T8-06` e `T8-07` após T7-02/T7-06; `T8-08 → T8-09`.

## Mapa de dependências entre PRs e tarefas
```
#4 schema ──► T7-01 ──► T7-02 ──► T7-03 ──┐
#1 shopee ──► T7-04 ─► T7-05               ├─► T7-06 ─► T7-10 ─► T7-11
#2 telegram ─────────────────► T7-06/07/08 │
#5 design ───────────────────► T7-06, T8-*
T7-08 ──► T8-02 ──► T8-03
T7-02 ──► T8-06 ; T7-06 ──► T8-07
```

## Critérios de saída da fase
- Itens 2, 3, 4, 5, 6, 7, 8, 10, 11 e 14 do checklist com evidência; item 9 reaproveitado do T3.
- `pnpm typecheck`, `pnpm test`, pgTAP e gitleaks verdes; **CI `test` hoje vermelho em #2 e #4 deve estar verde**.
- Auditoria do Farol (T7-11, T8-09) sem item crítico aberto.
- Itens que dependem de credencial real (1, 2, 3, 10) marcados "aguardando credencial" quando só o simulado rodou.

## Decisões pendentes que afetam esta fase
1. "Mandar agora" ignora a antirrepetição de 7 dias? (T8-06, T7-05)
2. Comissão insert-only vs. atualização de status (fica para a fase 5, mas o schema de #4 já fixa `commissions` como insert-only).
3. Role Postgres dedicada ao worker em vez de service role (decisão 003 H3) — decidir em T7-02.
