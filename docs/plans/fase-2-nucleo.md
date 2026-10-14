# Plano — Fase 2: Núcleo (checklist F2 + F3)

Autor: Farol (Planejador) · 2026-10-13 · Base: `docs/prd.md`, `docs/mvp-checklist.json`, decisões 001–003 (com pareceres de 2026-10-13).

> **Mapeamento de nomes.** Este plano cobre as fases **F2 (itens 4, 5, 9)** e **F3 (itens 6, 7, 8)** do `mvp-checklist.json`: automações, estimativa, criativo, agendador, antirrepetição e fila. As fases F4 (itens 10, 11, 14) e F5 (itens 12, 13) terão plano próprio depois. A tabela de rastreabilidade ao final mostra os 14 itens.

## Objetivo
Do cadastro de automações até o worker escolher ofertas, respeitar janela/fuso/antirrepetição e consumir a fila com 1 envio por vez por canal, sem envio duplo, com criativo PNG gerado. É a parte de maior risco do produto; os ajustes A1–A9 da decisão 001 são requisitos.

## Pré-requisitos
F1 fechada (schema, RLS, cliente Shopee, canal/grupos ativos). Credencial real da Shopee só é necessária para o teste de integração; o resto roda no servidor simulado.

## Tarefas
| ID | Tarefa | Item MVP | Depende de | Responsável sugerido |
|---|---|---|---|---|
| F2-01 | CRUD de automações (filtros jsonb, dias, janela, frequência 15/30/60, cabeçalho/rodapé, grupos) com validação no servidor e **limite de 5 por conta** imposto no banco (trigger ou RPC com lock por conta), não só na UI | 4 | F1-04, F1-07 | Dev + Designer |
| F2-02 | Função pura de estimativa: grupos × (janela em min ÷ frequência), limitada ao teto diário; janela que cruza meia-noite tratada | 5 | — | Dev |
| F2-03 | Exibir estimativa na tela de automação (usa F2-02) | 5 | F2-01, F2-02 | Dev + Designer |
| F2-04 | Criativo 1080×1080: Satori + Resvg, fontes no repo, layout aprovado, download seguro da imagem (allowlist, limites, anti-SSRF, decisão 002 C1–C5) | 9 | F1-02 | Dev + Designer |
| F2-05 | Busca de ofertas (`productOfferV2`) com filtros da automação, upsert em `offers` por (conta, item_id), validação de schema, escolha determinística da oferta | 6, 7 | F1-02, F1-03 | Dev |
| F2-06 | Agendador de 1 min: seleciona `automation_groups` vencidos (`FOR UPDATE SKIP LOCKED`), avalia dia/janela no fuso da conta, insere `send` com `idempotency_key` e avança `next_run_at` na mesma transação; não empilha | 6 | F2-01, F2-05 | Dev |
| F2-07 | Antirrepetição 7 dias (consulta de dedupe sobre `sent` e `failed` com resultado desconhecido, decisão 001 A5); oferta repetida vira `skipped` com motivo "repetida" | 7 | F2-06 | Dev |
| F2-08 | Fila: `claim_next_send(channel_id)` atômico (advisory xact lock + unique parcial `sending` + intervalo 60 s + teto 200/dia local + prioridade), execução do envio, `sent`/`failed`, sem retry | 8 | F1-06, F2-04, F2-06 | Dev |
| F2-09 | Lease e reaper (120 s, `failed` com motivo `lease_expirado_resultado_desconhecido`), relógio do banco | 8 | F2-08 | Dev |
| F2-10 | Suíte de relógio simulado: borda de janela, virada de dia, janela cruzando meia-noite, reset do teto à 00:00 de America/Cuiaba | 6 | F2-06, F2-08 | Dev + QA |
| F2-11 | Suíte de concorrência: 2+ workers contra o mesmo canal, crash no meio do envio, tick duplo | 8 | F2-08, F2-09 | QA |
| F2-12 | Auditoria da fase contra `docs/security-checklist.md` (D, E, F) e revisão de A1–A9 implementados | todos | F2-11 | Farol |

## Ordem sugerida
`F2-01/F2-02/F2-04/F2-05` em paralelo → `F2-03` e `F2-06` → `F2-07` e `F2-08` → `F2-09` → `F2-10/F2-11` → `F2-12`.

## Critérios de aceite
| # | Item | Critério (do checklist) | Evidência exigida |
|---|---|---|---|
| 4 | Automações CRUD, limite 5 | Validação testada e 6ª automação recusada | Teste cria 5 e recusa a 6ª; duas criações concorrentes na 5ª posição resultam em exatamente 1 aceita; mensagem de erro clara na UI |
| 5 | Estimativa de posts/dia | Teste de unidade da fórmula | Tabela de casos: 1 grupo × 08–20h/15 min; vários grupos; teto 200 limitando; janela 22:00–02:00; frequência não divisora da janela |
| 9 | Criativo PNG 1080×1080 | Snapshot visual aprovado pelo Designer | PNG de 1080×1080 por fixture (título curto, longo de 300 caracteres, sem imagem, preço com desconto); aprovação registrada do Designer; testes de rejeição da imagem (tipo, tamanho, host fora da allowlist, IP privado, timeout) |
| 6 | Worker agendador | Relógio simulado: borda de janela e virada de dia em America/Cuiaba | Casos: 1 s antes/depois do início e do fim da janela; 23:59:30→00:00:30; dia fora de `days`; janela cruzando meia-noite; reset de teto; nenhum offset fixo no código (grep) |
| 7 | Antirrepetição 7 dias | Reexecução do worker 2x sem duplicata | Rodar o tick 2× no mesmo instante e 2× em sequência: 1 `send`; mesmo item_id no mesmo grupo dentro de 7 d ⇒ `skipped`/"repetida"; no dia 8 volta a poder enviar; `failed` com resultado desconhecido também bloqueia |
| 8 | Fila 1/canal, 60 s, teto 200, prioridade 100 | Concorrência com 2 workers sem envio duplo | 2 workers × N sends no mesmo canal: nunca 2 `sending` simultâneos (unique parcial exercitado), intervalo entre envios ≥ 60 s medido no banco, 201º do dia não sai, prioridade 100 passa à frente, crash após `sending` ⇒ reaper → `failed`, sem retry |

Critérios transversais:
- `pnpm typecheck`, `pnpm test`, gitleaks verdes; cobertura dos ramos de decisão do claim.
- Nenhum `Date.now()`/relógio do worker em regra de negócio; tempo vem do banco ou de relógio injetável.
- Resposta da Shopee tratada como dado (schema inválido ⇒ `failed`/ignorada, nunca executada ou interpolada em consulta).
- Pontos 1 e 2 da seção "Pontos para decisão" da decisão 001 respondidos por Aurimar antes de F2-07/F2-08 fecharem.

## Riscos da fase
| Risco | Probabilidade | Mitigação |
|---|---|---|
| Duplicidade de envio por corrida ou crash | média | A2, A3, A5, F2-11 |
| Bug de fuso/virada de dia | alta | F2-10, IANA, sem offset fixo |
| Limite de taxa da Shopee/Telegram | média | Intervalo de 60 s por canal; erro tipado; sem retry agressivo |
| Qualidade das ofertas (filtros fracos) | média | Escolha determinística + log do motivo do descarte |
| Render do criativo lento dentro do lease | baixa | Timeout próprio de 15 s; medir no F2-04 |

## Rastreabilidade: 14 itens do `mvp-checklist.json`
| Item | Título | Fase checklist | Plano | Tarefas |
|---|---|---|---|---|
| 1 | Cliente Shopee assinado | F1 | fase-1-fundacao | F1-01, F1-02 |
| 2 | Conexões / Vault | F1 | fase-1-fundacao | F1-03–F1-05, F1-08, F1-09 |
| 3 | Canal Telegram | F1 | fase-1-fundacao | F1-06 |
| 4 | Automações CRUD (limite 5) | F2 | fase-2-nucleo | F2-01 |
| 5 | Estimativa posts/dia | F2 | fase-2-nucleo | F2-02, F2-03 |
| 6 | Worker agendador | F3 | fase-2-nucleo | F2-05, F2-06, F2-10 |
| 7 | Antirrepetição 7 dias | F3 | fase-2-nucleo | F2-05, F2-07 |
| 8 | Fila 1/canal, 60 s, 200, prio 100 | F3 | fase-2-nucleo | F2-08, F2-09, F2-11 |
| 9 | Criativo PNG | F2 | fase-2-nucleo | F2-04 |
| 10 | Mandar agora | F4 | a planejar (fase 3) | usa `claim_next_send` de F2-08 |
| 11 | Envios: cards, lista, Realtime | F4 | a planejar (fase 3) | depende de RLS (F1-04) para Realtime |
| 12 | Comissão a cada 6 h | F5 | a planejar (fase 4) | depende de subIds (F1-06, F2-08) |
| 13 | Alertas por e-mail | F5 | a planejar (fase 4) | heartbeat do worker (decisão 003 H5) |
| 14 | Onboarding e estados vazios | F4 | a planejar (fase 3) | depende de telas de F1/F2 |
