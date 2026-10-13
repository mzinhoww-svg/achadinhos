# STATUS
**Fase atual:** F0 — esqueleto e organização da equipe.

## Decisões
001 fila: tabela própria + SKIP LOCKED. 002 criativo: Satori+Resvg. 003 worker: VPS LetsCloud. 004 endpoint Shopee: pendente de confirmação.

## Orçamento (teto R$ 100/mês)
| Item | Estimativa | Observação |
|------|-----------|------------|
| Supabase | R$ 0 (free) | projeto novo; Vault e Realtime incluídos; revisar limites |
| Vercel | R$ 0 (Hobby) | uso comercial pode exigir Pro (~US$ 20); decidir antes do deploy |
| VPS LetsCloud | a estimar | consultar planos antes de criar |
| E-mail transacional | R$ 0 (free tier) | provedor a escolher |
Nenhum gasto realizado até aqui.

## Bloqueios
- Credenciais não encontradas no ambiente (nenhuma variável SHOPEE_*, TELEGRAM_*, SUPABASE_*, e-mail; nota "credenciais" não conectada a este terminal).
  Faltam: SHOPEE_APP_ID, SHOPEE_SECRET, TELEGRAM_BOT_TOKEN, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, credencial do provedor de e-mail.
- Itens dependentes de SHOPEE_*: seguem com servidor simulado e ficam "aguardando credencial".

## Próximos passos
Recrutar equipe, abrir painel, disparar T1–T4.
