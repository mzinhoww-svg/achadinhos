# Plano de deploy e custo mensal — achadinhos

Autor: Farol (Planejador). Data: 2026-10-14. Base: decisões 001–003, `docs/security-checklist.md` (seções A, C, F), `docs/ACTIONS.md`.
**Nada foi contratado nem criado.** Os preços do LetsCloud foram lidos por `list_plans` (somente leitura); os demais vêm de tabelas públicas dos provedores e precisam ser reconfirmados na hora de contratar.

## 1. Topologia

| Peça | Onde | Segredos que enxerga |
|---|---|---|
| Painel (`apps/web`) | Vercel | só `SUPABASE_URL` e anon key; sessão do usuário sob RLS. **Service role não existe no Vercel**, nem em Preview (decisão 003, H2) |
| Banco, Auth, Vault, Realtime | Supabase | — |
| Worker (`apps/worker`) | VPS LetsCloud, Node + systemd | service role (ou role dedicada, H3), lido de `EnvironmentFile` 0600; segredos da Shopee/Telegram só via Vault |
| E-mail de alerta | provedor transacional (a escolher) | chave de API no env do worker |
| Monitor externo (fora do VPS) | ping gratuito (healthchecks.io ou UptimeRobot) ou `pg_cron` no Supabase | URL de ping no env do worker (tratada como segredo) |

Fluxo de segredo: o painel grava no Vault por RPC só de escrita; só o worker lê.

## 2. Custo mensal estimado (teto R$ 100)

Câmbio de referência para os itens em US$: R$ 5,50 (premissa; reconferir).

| Item | Cenário MVP | Valor/mês | Observação |
|---|---|---|---|
| VPS LetsCloud `1vcpu-1gb-25ssd` (SAO1) | recomendado | **R$ 25,00** | 1 vCPU, 1 GB, 25 GB, 1 TB de banda; suficiente para um Node com tick de 1 min e Resvg |
| VPS `1vcpu-2gb-50ssd` | folga de memória, se o render estourar | R$ 50,00 | só se o monitoramento mostrar swap/OOM |
| Supabase Free | MVP | R$ 0 | 500 MB de banco; sem PITR; pausa por inatividade (o tick do worker gera tráfego, mas confirmar) |
| Vercel Hobby | MVP | R$ 0 | **termos do Hobby restringem uso comercial**; este painel é ferramenta de operação com afiliado, então tratar como zona cinzenta (ver decisão pendente) |
| E-mail transacional, free tier | MVP | R$ 0 | alerta de worker parado e falha de credencial: dezenas de e-mails/mês |
| Domínio | opcional | ~R$ 3–5 (R$ 40/ano) | só se quiser domínio próprio; senão `*.vercel.app` |
| **Total base** | | **R$ 25,00** | 25% do teto |

Cenários:

| Cenário | Composição | Total |
|---|---|---|
| Base | VPS 1 GB + tudo free | R$ 25 |
| Conservador | VPS 2 GB + domínio | ~R$ 55 |
| Vercel Pro (uso comercial) | VPS 1 GB + Pro ~US$ 20 (~R$ 110) | **~R$ 135, estoura o teto** |
| Supabase Pro | VPS 1 GB + US$ 25 (~R$ 138) | **~R$ 163, estoura o teto** |

Leitura: o MVP cabe com folga **enquanto Vercel e Supabase ficarem no free**. Qualquer upgrade pago de um deles sozinho já ultrapassa R$ 100. Alternativa se o Hobby for vetado: hospedar o painel também no VPS (Node `next start` atrás de Caddy/nginx com TLS), custo R$ 0 adicional, ao preço de operar o painel (ver 4).

## 3. Pré-requisitos antes do primeiro deploy

Ações de Aurimar (já em `docs/ACTIONS.md`): credenciais Shopee, bot do Telegram, projeto Supabase novo, provedor de e-mail. Sem elas nada é publicado.

Ordem sugerida, cada passo com ponto de parada:
1. **Supabase**: criar projeto, aplicar migrações, rodar pgTAP **e** o contrato `tests/contract` contra ele (hoje só em container), conferir advisors (RLS ligado em todas as tabelas, sem função `SECURITY DEFINER` exposta). Gerar a role dedicada do worker.
2. **Vercel**: configurar apenas `NEXT_PUBLIC_SUPABASE_URL` e anon key; `ACHADINHOS_DEMO_SESSION` **ausente** em todos os ambientes (parecer #11, R1).
3. **VPS**: criar usuário de serviço sem shell, SSH só por chave, `ufw` só com SSH, atualizações automáticas, NTP, `TZ=UTC`; unit systemd com `Restart=always` e `EnvironmentFile` 0600 fora do repo.
4. **Worker**: subir com `LOG_LEVEL=info`, `DATABASE_URL` do pooler (seção 3.1), um canal de teste e `enqueue_send_now` manual.
   - Testar a conexão com o banco **antes** de qualquer outra coisa (falha aqui trava o deploy no primeiro minuto).
   - Matar o processo de propósito e confirmar que o e-mail do monitor externo chega em até 3 min (seção 3.2).
   - Testar "bot removido do grupo" e "Shopee fora do ar" no canal de teste antes do primeiro envio real.
5. **Primeiro envio real** só em grupo de teste, com a conta de teste do bot.

### 3.1 Conexão com o banco (IPv6 e pooler)

O host direto do Supabase (`db.<ref>.supabase.co`) é IPv6 e o plano free não inclui o complemento IPv4: um VPS sem IPv6 não conecta. `DATABASE_URL` do worker **deve** ser a connection string do **pooler em modo transaction** (porta **6543**; a 5432 do pooler é modo sessão), compatível com `pg_advisory_xact_lock` do claim (decisão 001, A3; lock de sessão continua proibido). `DATABASE_URL` entra no `addSecret` do logger.

**Prepared statements:** o modo transaction não aceita prepared statements nomeados. O cliente Postgres do adaptador (T7-12) deve rodar sem eles (`prepare: false` no `postgres`, ou queries parametrizadas sem nome no `pg`). Verificar no teste de conexão do passo 4.

### 3.2 Monitor externo e limite único do alerta

- **Limite único: 3 minutos** (decisão 003, H5), igual em todos os documentos e no código. O `loadConfig` do #30 exige `WORKER_STALL_ALERT_MS` **estritamente maior** que `HEARTBEAT_STALE_MS` (padrão 180000), então o par obrigatório no `EnvironmentFile` é:

  ```
  HEARTBEAT_STALE_MS=120000      # 2 x tick de 60 s (mínimo aceito)
  WORKER_STALL_ALERT_MS=180000   # 3 min
  ```

  Só `WORKER_STALL_ALERT_MS=180000` com o padrão de `HEARTBEAT_STALE_MS` **não sobe** (`ConfigError`). O padrão de 600000 do código e dos alertas (#8) não vale em produção.
- O `checkStalled` roda dentro do processo do worker: com processo morto ou VPS fora, ninguém alerta. Por isso é obrigatório um monitor **fora do VPS**:
  - opção A (preferida, R$ 0): healthchecks.io (free, período mínimo de 1 min, e-mail) chamado pelo worker a cada tick **bem-sucedido**, com período de 1 min e tolerância de 2 min. UptimeRobot só se o monitor de heartbeat estiver no plano free: **confirmar no dia**;
  - opção B (R$ 0): `pg_cron` no Supabase + função que lê o heartbeat persistido (`checkWorkerStalled`) e dispara o e-mail.
- Sem um dos dois, o item "alerta em 3 min" do checklist F **não é cumprível** e não pode ser marcado.
- **O ping ainda não existe no código** (o #30 tem só `checkStalled` interno e `checkWorkerStalled`, que ninguém agenda). Tarefa a abrir: o worker envia o ping só depois de um tick sem exceção, com a URL do monitor tratada como segredo. Até lá o item F fica `parcial`.

### 3.3 Limites que o plano precisa contar

| Recurso | Limite (free) | Estimativa | Ação |
|---|---|---|---|
| Storage dos criativos | 1 GB | PNG ~46 KB × até 200/dia × 30 ≈ 280 MB/mês; enche em ~3–4 meses | expiração: apagar o objeto 7 dias após o envio (alinhado à antirrepetição) + alerta de uso (80%) |
| Egress | 5 GB/mês | irrelevante para 1 operador | registrar o limite |
| Conexões Realtime | 200 | irrelevante para 1 operador | registrar o limite |
| Vault | fora do export semanal (D2) | — | se o projeto Supabase se perder, App ID/Secret e tokens são digitados de novo; registrar no runbook |
| Banco | 500 MB | histórico de envios cresce linearmente | revisar retenção junto com o storage |

## 4. Riscos e decisões que o plano deixa abertas

| # | Ponto | Recomendação |
|---|---|---|
| D1 | Vercel Hobby vs. uso comercial | Aurimar decide: aceitar o risco de termos no MVP, pagar Pro (estoura o teto) ou servir o painel pelo VPS |
| D2 | Supabase free pausa e não tem backup | Export semanal de contas/automações/grupos (decisão 003, H6); aceitar perda do histórico de envios no MVP |
| D3 | Service role no VPS ignora RLS | Role Postgres dedicada ao worker antes do primeiro deploy (H3); aqui ainda aberta |
| D4 | Ponto único de falha (1 VPS) | Aceito no MVP; `Restart=always`, alerta em 3 min **via monitor externo** (3.2), fila concorrente-segura permite subir outro nó |
| D5 | Câmbio e preços de terceiros | Reconferir no dia da contratação; atualizar `STATUS.md` |
| D6 | Servir o painel pelo VPS (alternativa ao Hobby) | Cabe no teto (R$ 0 extra), mas move TLS, atualização e `next start` para a operação; estimar ~½ dia de montagem e manutenção recorrente antes de escolher |

## 5. Texto sugerido para `STATUS.md` (seção Orçamento)

| Item | Estimativa | Observação |
|---|---|---|
| Supabase | R$ 0 (Free) | Pro = ~US$ 25, estoura o teto; sem PITR |
| Vercel | R$ 0 (Hobby) | uso comercial pode exigir Pro (~US$ 20); decidir antes do deploy |
| VPS LetsCloud | **R$ 25,00** (`1vcpu-1gb-25ssd`, SAO1) | 2 GB = R$ 50; preços via `list_plans` em 2026-10-14 |
| E-mail transacional | R$ 0 (free tier) | provedor a escolher |
| **Total base** | **R$ 25/mês** | teto R$ 100; nenhum gasto realizado |

## 6. O que bloqueia o primeiro deploy

Estado verificado em 2026-10-14 contra a `main` (#30 mergeado) e as auditorias do Planejador nos PRs #33–#38. Resolvido: `blockingHistory` por sufixo `_resultado_desconhecido` (#14); bot sem acesso desativa o grupo na porta do runtime (#30); flag demo bloqueada em produção (#38); `finished_at` do `skipped` e `hasOpenSend` por prefixo (#37).

### Antes de aplicar qualquer migração
- **Versões de migração duplicadas:** #34, #35, #36 e #38 usam `20261015120000`; a segunda a aplicar falha em `schema_migrations`. Renomear com timestamps únicos e acrescentar um passo de CI que liste versões repetidas.
- **Projeto Supabase:** cadastro aberto desligado (convite/allowlist) — `web_account()` cria conta para qualquer autenticado; pgTAP e `tests/contract` rodados contra o projeto real; validar que `CREATE ROLE achadinhos_worker … IN ROLE service_role` e `ALTER ROLE … SET role` funcionam com o `postgres` do hospedado.

### Banco e privilégios
- Privilégio por coluna em `shopee_credentials` e `channels`: `status`, `validation_status`, `validated_at`, `last_error`, `secret_id`, `config_secret_id` só por RPC `DEFINER` ou worker (#38 R1).
- `REVOKE TRUNCATE, UPDATE, DELETE` das tabelas insert-only (`sends`, `commissions`, `commission_events`) de `service_role` e da role do worker; `REVOKE INSERT ON commissions FROM authenticated` (#36 R2, R3).
- `worker_read_secret` com escopo de conta pelo nome `achadinhos/<conta>/…` (#37 R3).
- `CHECK` em `days` (0–6, não vazio) e `window_start <> window_end`; cota de segredos não anexados no Vault com limpeza de órfãos (#38 R3, R4).
- `sub_id` sem dígitos do chat id (#38 R5).

### Worker (PR de ligação)
- Chamar `assertWorkerRole` na partida e montar o cliente só por `openPgClient()`; variável `DATABASE_CA_CERT_FILE` para a CA do Supabase (#37 R1, R4).
- `groups.deactivate` com adaptador SQL e `AND g.active` no `claim_next_send`; `queued` de grupo desativado vira `skipped/grupo_inativo` (#30 R2, #37 R5).
- `addSecret` de todo valor lido do Vault (#37 R6); TTL de `queued` (#30 R1); `tsx` fora de `devDependencies` ou build compilado (#30 R5).
- Guarda de IP com `node:net.BlockList` e `maxPixels` ≈ 4 Mpx, com repasse pelo worker (#33 R1, R3).
- Semântica de preço (`priceMin`/`priceMax` ≠ preço original) confirmada com resposta real (#37 R7; decisão 004).

### Alertas e observabilidade
- Monitor externo ao VPS com ping a cada tick bem-sucedido (3.2); o código do ping ainda não existe.
- Limiar único de 180000 ms entre `createHeartbeatMonitor` e `AlertService`; par `HEARTBEAT_STALE_MS=120000` / `WORKER_STALL_ALERT_MS=180000` (#35 R1).
- Destinatário `ALERT_EMAIL_TO` obrigatório e sem literal pessoal no código (#35 R2).
- Tick com todos os grupos em erro não pode contar como saudável (#30 R3).

### Painel
- Token do Realtime preenchido no servidor depois de `getUser()`; verificação servidor de que `NEXT_PUBLIC_SUPABASE_ANON_KEY` não é `service_role`; publicação de `sends` só com as colunas que a tela usa (#34 R2, R3, R5).
- Adaptador da busca de oferta (consulta à Shopee fora do web) para o "Mandar agora" funcionar em produção.

### Processo
- CI com `next build` e pgTAP (issue #26).
- Credenciais reais (Shopee, Telegram, Supabase) e provedor de e-mail definidos (`docs/ACTIONS.md`).
