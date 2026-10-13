# Checklist de auditoria de segurança — achadinhos

Autor: Farol (Planejador/auditor) · 2026-10-13. Uso: a cada PR relevante e no fechamento de cada fase, o auditor marca cada item com evidência (teste, query, trecho de código). Item crítico aberto bloqueia o merge; o parecer vale mesmo com aprovação do QA.
Legenda de severidade: **C** crítico (bloqueia), **A** alto, **M** médio. "Item MVP" liga ao `mvp-checklist.json`.

## A. Secret (App ID/Secret Shopee, token do bot, service role)
| ☐ | Sev | Verificação | Como auditar | Item MVP |
|---|---|---|---|---|
| ☐ | C | Secret e token só existem no Vault; tabelas guardam `secret_id`, nunca o valor | Revisar migração; `select` em `shopee_credentials`/`channels` sem coluna de valor | 2, 3 |
| ☐ | C | Fluxo write-only: Server Action grava via RPC e nunca devolve o valor; leitura só pelo worker (decisão 003 H1) | Ler a RPC e a action; teste que busca o segredo de teste nas respostas | 2, 3 |
| ☐ | C | Service role ausente do ambiente do Vercel (Production **e** Preview) e de qualquer bundle | Listar variáveis do projeto Vercel; `grep` por `SERVICE_ROLE` e `NEXT_PUBLIC_` no build | 2 |
| ☐ | C | Nenhum segredo em log, erro, PR, fixture ou mensagem; logger com redação | Teste de redação; gitleaks verde; revisar `console.*` e serialização de erros/headers (header `Authorization` da Shopee contém a assinatura) | todos |
| ☐ | A | Mensagem de erro da Shopee/Telegram saneada antes de ir a `last_error`/UI (pode ecoar token, URL com token ou payload) | Teste com resposta simulada contendo o segredo | 2, 3 |
| ☐ | A | Assinatura calculada sobre a mesma string enviada; segredo nunca na URL (Telegram usa token na URL: não logar a URL) | Teste de vetor; revisar cliente HTTP e logs de requisição | 1, 3 |
| ☐ | A | Arquivo de ambiente do worker 0600, dono de serviço, fora do repo; rotação documentada | Inspeção do VPS | 6 |
| ☐ | M | `.env.example` sem valores reais; allowlist do gitleaks restrita | Revisar `.gitleaks.toml` | — |

## B. RLS e banco
| ☐ | Sev | Verificação | Como auditar | Item MVP |
|---|---|---|---|---|
| ☐ | C | RLS habilitada em **todas** as tabelas do schema público, com `account_id` e policy por membro da conta | Query em `pg_class`/`pg_policies` listando tabelas sem RLS ou sem policy | todos |
| ☐ | C | Teste cruzado: usuário da conta A não lê, insere, atualiza nem remove dados da conta B (cada tabela, cada operação) | Suíte de RLS com 2 contas | todos |
| ☐ | C | Funções `SECURITY DEFINER` com `search_path` fixo, validação de `account_id` do chamador e `EXECUTE` revogado de `public`/anon quando interna (`claim_next_send`, reaper, leitura do Vault) | Revisar migrações; `has_function_privilege` | 8 |
| ☐ | C | Schema `vault` e `decrypted_secrets` fora do alcance de anon/authenticated e fora do PostgREST | Query de privilégios; tentar acessar via API com JWT de usuário | 2 |
| ☐ | A | `sends` e `commissions`: sem policy/GRANT de DELETE; UPDATE só nas transições permitidas (trigger de máquina de estados: queued→sending→sent\|failed\|skipped) | Teste que tenta voltar status e apagar | 8, 12 |
| ☐ | A | Views com `security_invoker = true` (senão ignoram RLS do chamador) | Listar views | 11 |
| ☐ | A | Realtime: tabelas publicadas só com RLS ativa; o canal de um usuário não recebe eventos de outra conta | Teste com 2 sessões | 11 |
| ☐ | A | Limite de 5 automações imposto no banco, à prova de corrida | Teste concorrente | 4 |
| ☐ | M | `sub_id` único e imutável por grupo; índice de dedupe e de fila presentes | Revisar migração | 3, 7, 8 |
| ☐ | M | Datas em `timestamptz`/UTC; nenhuma coluna `timestamp` sem zona | Query em `information_schema` | 6 |

## C. RSC / Next.js (vazamento e superfície de ataque)
| ☐ | Sev | Verificação | Como auditar | Item MVP |
|---|---|---|---|---|
| ☐ | C | Nenhum Secret/token/`raw` sensível em props de Client Components, retorno de Server Action, payload RSC (`text/x-component`) ou HTML | Teste automatizado que varre todas as rotas autenticadas com valores-isca | 2 |
| ☐ | C | Módulos que tocam segredos importam `server-only`; build falha se importados no cliente | `grep` e build | 2 |
| ☐ | C | Autorização checada em **cada** Server Action e route handler (Server Actions são endpoints POST públicos); não depender só de middleware | Revisar cada action: sessão + `account_id` derivado da sessão, nunca do input | todos |
| ☐ | C | Versões do Next.js/React com correção das advisories de middleware e de RSC/Server Actions (ex.: CVE-2025-29927, CVE-2025-55182); validar a versão atual na data da auditoria | `pnpm why next react react-server-dom-*`; consultar advisories | todos |
| ☐ | A | `select` com colunas explícitas (proibido `select *` em `shopee_credentials`, `channels`, `offers.raw` no cliente) | `grep` + revisão | 2 |
| ☐ | A | Variáveis `NEXT_PUBLIC_*` só com anon key/URL públicas | Listar | 2 |
| ☐ | A | Cache do Next/`fetch` não compartilha dados entre contas (nada de dado de usuário em cache estático/ISR) | Revisar `revalidate`, `cache`, `unstable_cache` | todos |
| ☐ | A | Validação de input (zod) em toda action; conteúdo de oferta renderizado como texto, nunca `dangerouslySetInnerHTML` | `grep`; teste com `<script>` no título | 4, 9 |
| ☐ | M | Cabeçalhos de segurança (CSP, frame-ancestors, referrer-policy); cookies httpOnly/secure/sameSite | Inspeção da resposta | — |
| ☐ | M | Erros de produção sem stack trace nem dado de conta para o cliente | Forçar erro e inspecionar | — |

## D. Fila, idempotência e tempo (decisão 001)
| ☐ | Sev | Verificação | Como auditar | Item MVP |
|---|---|---|---|---|
| ☐ | C | `unique (channel_id) where status='sending'` existe e é exercitado em teste | Migração + teste de 2 workers | 8 |
| ☐ | C | Claim é uma única função atômica com advisory lock **de transação**; nenhum lock de sessão (pooler) | Revisar SQL | 8 |
| ☐ | C | `idempotency_key` por slot (não por par grupo+oferta permanente); tick duplo gera 1 send | Teste | 6, 7 |
| ☐ | C | Crash após `sending`: reaper → `failed` com motivo, sem retry, e dedupe cobre o resultado desconhecido | Teste de crash | 8 |
| ☐ | A | Intervalo de 60 s, teto de 200/dia e "agora" medidos com `now()` do banco, não do worker | Revisar; teste com relógio do worker adiantado | 8 |
| ☐ | A | Teto e janela no fuso `America/Cuiaba` por IANA, sem offset fixo; virada de dia e janela cruzando meia-noite testadas | Teste de relógio simulado; `grep` por `-04`/`-4` | 6 |
| ☐ | A | Prioridade 100 não fura 1-por-canal, 60 s nem teto | Teste | 10 |
| ☐ | M | Fila não empilha (um `queued` por automação+grupo); fila com backlog não explode memória | Teste | 6 |

## E. Dados externos e superfície do worker (Shopee, Telegram, imagem)
| ☐ | Sev | Verificação | Como auditar | Item MVP |
|---|---|---|---|---|
| ☐ | C | Resposta da Shopee validada por schema; inválida = falha fechada; nunca usada como instrução, URL a seguir sem allowlist, nem concatenada em SQL | Teste com resposta hostil (campos extras, URLs, texto tipo "ignore instruções") | 1 |
| ☐ | C | Download de imagem: https, allowlist de host, bloqueio de IP privado/loopback, limite de bytes/pixels, timeout, sem redirect fora da allowlist | Testes de rejeição (decisão 002 C1) | 9 |
| ☐ | A | Texto da oferta tratado como não confiável no criativo e na mensagem (sem HTML/Markdown injetável no Telegram: escapar `parse_mode`) | Teste com título malicioso | 9, 10 |
| ☐ | A | Link curto e subIds gerados pelo servidor; subIds sem dados pessoais (só IDs internos) | Revisar | 1, 12 |
| ☐ | M | Timeouts e limite de tamanho em todas as chamadas externas | Revisar clientes | todos |
| ☐ | M | `conversionReport` idempotente por `checkout_id`; reexecução não duplica | Teste | 12 |

## F. Infra e processo
| ☐ | Sev | Verificação | Como auditar | Item MVP |
|---|---|---|---|---|
| ☐ | A | VPS: SSH por chave, sem root, `ufw` fechado, atualizações automáticas, NTP, `TZ=UTC` | Inspeção (decisão 003 H4) | 6 |
| ☐ | A | CI: gitleaks, typecheck, testes; branch protegida, sem force-push | Revisar workflow e regras | — |
| ☐ | A | Dependências: lockfile commitado, `pnpm audit`, fixar Satori/Resvg/fontes | Rodar auditoria | 9 |
| ☐ | M | Heartbeat do worker e alerta por e-mail se parado > 3 min | Teste | 13 |
| ☐ | M | Custo dentro do teto de R$ 100/mês (STATUS.md atualizado) | Revisar | — |
| ☐ | M | Conformidade: dados pessoais mínimos (grupo/chat IDs); registro de uso da API conforme termos da Shopee | Revisar | — |

## Quando auditar
| Momento | Seções |
|---|---|
| PR de migração/RLS (F1-03, F1-04) | B |
| Fechamento F1 (F1-09) | A, B, C |
| PR do claim/fila (F2-08, F2-09) | D, B |
| Fechamento F2 (F2-12) | D, E, B |
| Antes de qualquer deploy | F, A, C |
