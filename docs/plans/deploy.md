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
1. **Supabase**: criar projeto, aplicar migrações, rodar pgTAP contra ele, conferir advisors (RLS ligado em todas as tabelas, sem função `SECURITY DEFINER` exposta). Gerar a role dedicada do worker.
2. **Vercel**: configurar apenas `NEXT_PUBLIC_SUPABASE_URL` e anon key; `ACHADINHOS_DEMO_SESSION` **ausente** em todos os ambientes (parecer #11, R1).
3. **VPS**: criar usuário de serviço sem shell, SSH só por chave, `ufw` só com SSH, atualizações automáticas, NTP, `TZ=UTC`; unit systemd com `Restart=always` e `EnvironmentFile` 0600 fora do repo.
4. **Worker**: subir com `LOG_LEVEL=info`, um canal de teste e `enqueue_send_now` manual; observar heartbeat e e-mail de alerta.
5. **Primeiro envio real** só em grupo de teste, com a conta de teste do bot.

## 4. Riscos e decisões que o plano deixa abertas

| # | Ponto | Recomendação |
|---|---|---|
| D1 | Vercel Hobby vs. uso comercial | Aurimar decide: aceitar o risco de termos no MVP, pagar Pro (estoura o teto) ou servir o painel pelo VPS |
| D2 | Supabase free pausa e não tem backup | Export semanal de contas/automações/grupos (decisão 003, H6); aceitar perda do histórico de envios no MVP |
| D3 | Service role no VPS ignora RLS | Role Postgres dedicada ao worker antes do primeiro deploy (H3); aqui ainda aberta |
| D4 | Ponto único de falha (1 VPS) | Aceito no MVP; `Restart=always`, alerta em 3 min, fila concorrente-segura permite subir outro nó |
| D5 | Câmbio e preços de terceiros | Reconferir no dia da contratação; atualizar `STATUS.md` |

## 5. Texto sugerido para `STATUS.md` (seção Orçamento)

| Item | Estimativa | Observação |
|---|---|---|
| Supabase | R$ 0 (Free) | Pro = ~US$ 25, estoura o teto; sem PITR |
| Vercel | R$ 0 (Hobby) | uso comercial pode exigir Pro (~US$ 20); decidir antes do deploy |
| VPS LetsCloud | **R$ 25,00** (`1vcpu-1gb-25ssd`, SAO1) | 2 GB = R$ 50; preços via `list_plans` em 2026-10-14 |
| E-mail transacional | R$ 0 (free tier) | provedor a escolher |
| **Total base** | **R$ 25/mês** | teto R$ 100; nenhum gasto realizado |

## 6. O que bloqueia o primeiro deploy (visão de planejamento)

Depende da auditoria final da T7 (security-checklist D, E, B, F), que só roda quando o PR do Balanço (worker-entry + e2e) abrir. Bloqueios já conhecidos, herdados dos pareceres anteriores:
- `blockingHistory` do agendador comparar por igualdade em vez de `endsWith("_resultado_desconhecido")` (parecer #14).
- Claim sem filtro de grupo ativo/janela e `automation_id` ausente em `sends` (gates T7-10).
- `addSecret` em todo segredo no logger e role dedicada do Vault/worker (pareceres #16, #19).
- Flag `ACHADINHOS_DEMO_SESSION` bloqueada em produção (parecer #11, R1).
- Credenciais reais e provedor de e-mail definidos.
