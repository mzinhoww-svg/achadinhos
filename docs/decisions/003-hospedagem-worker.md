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
