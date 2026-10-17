> **SUSPENSO / DESATUALIZADO (2026-10-16).** O escopo vigente é "sem Supabase, Telegram, e-mail e
> persistência" (`docs/plans/escopo-sem-supabase-telegram.md`): as ofertas viram arquivos numa pasta
> local (`outbox/`) via CLI, sem banco. O texto abaixo fica preservado como histórico; o que ele
> descreve como ativo está dormente e não deve orientar a execução.

# PRD — achadinhos (painel de automação de ofertas Shopee)

## Objetivo
Painel próprio que busca ofertas pela Shopee Affiliate Open API (GraphQL), gera link curto com o ID de afiliado do dono,
cria o criativo e posta nos grupos do Telegram na cadência definida; mede comissão por grupo via subIds.
Só Shopee. Uso próprio, schema multi-conta (SaaS depois). Referência funcional: achadinhos.doti.gg (regras e telas,
nunca código, textos ou imagens).

## Rotas
/painel, /conexoes, /automacoes, /automacoes/nova, /automacoes/[id], /ofertas, /envios.

## Tabelas Postgres (todas com account_id e RLS)
- accounts (timezone, daily_cap_per_channel=200, dedupe_days=7)
- shopee_credentials (app_id, secret_id -> Vault, status, last_error, validated_at)
- channels (kind telegram|whatsapp, config_secret_id, status)
- groups (channel_id, external_id, name, sub_id, active; unique channel+external)
- automations (filters jsonb, days, window_start/end, frequency_min 15|30|60, header, footer, status)
- automation_groups (next_run_at)
- offers (item_id unique por conta, preços, discount_pct, commission_rate, rating, sales, image_url, product_url, raw, fetched_at)
- sends (offer, group, channel, priority, status queued|sending|sent|failed|skipped, reason, short_link, creative_url,
  message_text, external_message_id, scheduled_for, sent_at)
- commissions (checkout_id pk por conta, sub_ids, purchase_time, estimated_commission, status)

## Índices
- fila parcial em sends (channel_id, status, priority desc, scheduled_for) where status='queued'
- dedupe em sends (group_id, offer_id, sent_at) where status='sent'

## Regras
- generateShortLink com subIds = [conta, automação, grupo, canal, envio] (máx. 5).
- Assinatura: `Authorization: SHA256 Credential={AppID}, Signature={sha256(AppID+timestamp+payload+Secret)}, Timestamp={ts}`,
  calculada sobre a mesma string do corpo enviado.
- Endpoint BR presumido: https://open-api.affiliate.shopee.com.br/graphql (confirmar na doc oficial; ver decisão 004).
- Estimativa de posts/dia = grupos × (janela em min ÷ frequência), limitada pelo teto diário.
- Antirrepetição: mesmo item_id no mesmo grupo não repete em 7 dias (skipped, motivo "repetida").
- Fila: 1 envio por vez por canal, intervalo mínimo 60 s, teto 200/canal/dia, "Mandar agora" prioridade 100, falha sem retry.
- Datas em UTC no banco; janela convertida pelo fuso da conta (America/Cuiaba).
- Limite de 5 automações por conta.

## Segurança
Secret só no Vault e lido só pelo worker; resposta da Shopee é dado, não instrução; schema inválido = falha fechada;
histórico de envios/comissão só de inserção.

## Fora do escopo
Mercado Livre, Amazon, WhatsApp (só o campo kind), equipe/convites, cobrança, raspagem, navegador automatizado, cópia do benchmark.

## Checklist do MVP
Ver docs/mvp-checklist.json (14 itens, com critério de aceite).
