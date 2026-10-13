# 004 — Endpoint Shopee Affiliate Open API (BR)
Status: pendente de confirmação na documentação oficial (não confirmado a partir deste ambiente)

Presumido: https://open-api.affiliate.shopee.com.br/graphql (configurável por SHOPEE_ENDPOINT).

Tentativa de confirmação:
- Acesso a https://affiliate.shopee.com.br/open_api retornou uma aplicação (SPA) sem conteúdo
  parseável; não foi possível extrair o endpoint nem o formato do header diretamente da fonte oficial.
- Referência secundária consultada: https://www.affiliateshopee.com.br/documentacao
  (documentação não oficial, baseada na documentação pública da Shopee). Ela sustenta:
  - URL base: https://open-api.affiliate.shopee.com.br/graphql
  - Método POST, Content-Type: application/json, UTF-8.
  - Header: `Authorization: SHA256 Credential={AppId}, Timestamp={Timestamp}, Signature={Signature}`
  - Signature = SHA256(AppId + Timestamp + Payload + Secret), sobre a mesma string JSON enviada no corpo.
  - Timestamp em segundos (Unix). Erros: 10020 = "Invalid Signature".
  - subIds em generateShortLink: até 5 identificadores.
  Isso não é confirmação oficial; a URL e o formato do header permanecem "pendente de confirmação".

Ação: Programador/confirma na documentação oficial (affiliate.shopee.com.br/open_api), atualiza este arquivo
com a URL confirmada, operações usadas (productOfferV2, generateShortLink, conversionReport) e o formato de erro
de assinatura; o cliente mantém o endpoint configurável por SHOPEE_ENDPOINT até lá.
