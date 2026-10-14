# 003 — Hospedagem do worker
Status: aceita; gasto pendente de estimativa (ver STATUS.md)
## Opções
1. **VPS LetsCloud (Node + systemd/pm2)**: processo long-running, tick de 1 min confiável, secrets via env, previsível; já autorizado.
2. Vercel Cron: mínimo e limites por plano, funções curtas, ruim para fila 1-por-vez.
3. Supabase pg_cron + Edge Functions: acopla regra de negócio ao banco e dificulta teste.
## Decisão
Opção 1. Só o worker lê o Secret (Vault via service role). Painel no Vercel não tem a service role exposta ao cliente.
## Custo
Estimar plano mais barato via LetsCloud list_plans antes de contratar; teto geral R$ 100/mês.

## Parecer do Planejador (Farol) — 2026-10-13
**Veredito: ACEITA COM AJUSTES** (custo continua pendente de estimativa).
- **H1 — Contradição a resolver nos itens 2 e 3 do MVP.** A decisão diz "só o worker lê o Secret", mas salvar App ID/Secret (item 2) e token do bot (item 3) acontece numa tela do painel no Vercel, e a validação precisa chamar a Shopee/Telegram com o segredo. Desenho recomendado: Server Action recebe o segredo por TLS, grava no Vault via RPC `SECURITY DEFINER` com escopo na própria conta (só escrita, nunca retorna o valor) e marca `status = 'pending_validation'`; o **worker** lê o Vault, valida e atualiza `status`/`last_error`. O painel nunca lê de volta. O worker precisa de um laço rápido (5–10 s) para tarefas pendentes de validação, separado do tick de 1 min, para a UI não esperar um minuto.
- **H2 — Service role não deve existir no ambiente do Vercel**, nem como variável "não pública" (incluindo Preview). O painel usa só anon key + sessão do usuário sob RLS. "Mandar agora" é a RPC `enqueue_send_now` (decisão 001, M2) chamada pelo usuário autenticado, sem service role e sem INSERT direto em `sends`.
- **H3 — Raio de explosão da service role no VPS.** Ela ignora RLS. Mitigação mínima: arquivo `EnvironmentFile` 0600 de usuário de serviço dedicado, fora do repo, nunca em log; redação de segredos no logger; rotação documentada. Preferível: role Postgres dedicada ao worker com GRANT só nas tabelas/RPCs necessárias. Decidir na T2.
- **H4 — Hardening do VPS.** SSH só por chave, sem root, `ufw` sem porta de entrada além do SSH, atualizações automáticas de segurança, relógio por NTP (o tempo de verdade vem do `now()` do banco, mas logs e lease precisam de relógio sano), `TZ=UTC`.
- **H5 — Observabilidade mínima.** Heartbeat do tick gravado no banco; alerta por e-mail (item 13) se não houver tick há mais de 3 min. `Restart=always` no systemd. Deploy com sobreposição é seguro porque a fila é concorrente-segura (decisão 001, A2/A9).
- **H6 — Backup.** Supabase free não tem PITR; documentar export periódico do que importa (contas, automações, grupos) e aceitar perda de histórico de envios como risco do MVP.
