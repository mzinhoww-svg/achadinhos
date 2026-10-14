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

## O que o PR #1 estabeleceu (parecer do Planejador, 2026-10-13)
Estado geral: **parcialmente confirmado por fonte secundária; confirmação oficial continua pendente.** O PR #1 (commit de6262a, aprovado pelo QA e auditado) não conseguiu ler a documentação oficial (SPA sem conteúdo parseável) e implementou o contrato descrito na referência não oficial.

| Ponto | Situação | Onde está no código |
|---|---|---|
| URL base `https://open-api.affiliate.shopee.com.br/graphql`, POST JSON UTF-8 | **Presumido** (fonte secundária); configurável por `endpoint`/`SHOPEE_ENDPOINT`. Exigir `https` e allowlist de host (auditoria R2) | `client.ts` `DEFAULT_ENDPOINT` |
| Header `Authorization: SHA256 Credential={AppId}, Timestamp={ts}, Signature={sig}` | **Implementado** conforme a referência; o PRD lista a ordem `Credential, Signature, Timestamp` (ordem, a confirmar) | `client.ts` `request` |
| `Signature = SHA256(AppId + Timestamp + Payload + Secret)` sobre a mesma string do corpo | **Verificado em teste** (vetor conhecido + recálculo sobre o corpo enviado) | `ShopeeClient.sign` |
| `Timestamp` em segundos Unix, do relógio do host | Implementado; tolerância de defasagem (skew) da Shopee **desconhecida**; o mock não a aplica | `request` |
| Erro de assinatura: `errors[0].extensions.code = 10020` / mensagem "Invalid Signature" | **Presumido**; o mock devolve isso. Status HTTP em que a Shopee o entrega é **desconhecido**: hoje 401/403 vira `ShopeeNetworkError` sem status (auditoria R3) | `client.ts`, `mock-server` |
| Erro de timestamp | Detectado só por texto "timestamp" na mensagem; código real **desconhecido** | `client.ts` |
| Operações e campos usados | `productOfferV2` (19 campos do nó + `pageInfo`), `generateShortLink` (`subIds` ≤ 5, aplicado no cliente), `conversionReport` (`scrollId`, `orders.items`) | `client.ts`, `schemas.ts` |
| Tipos numéricos (`priceMin`, comissões podem vir como string?) | **Desconhecido**: schema aceita `number` para preços e `string\|number` para comissões; se a API real divergir, o cliente falha fechado | `schemas.ts` |
| Limites de taxa, paginação máxima, `subIds` com restrições de caracteres | **Desconhecidos** | — |

### Para fechar esta decisão
1. Aurimar (ou o Dev com a credencial) executa uma chamada real de `productOfferV2` e uma de `generateShortLink` e registra aqui: URL, status HTTP e corpo de um erro de assinatura propositalmente inválido, tolerância de timestamp, tipos reais de preço/comissão, limite de taxa.
2. Enquanto isso o item 1 do `mvp-checklist.json` fica "aguardando credencial" no teste de integração real; o cliente continua testado contra o servidor simulado.
3. Pré-condições de segurança antes do worker usar o cliente: R1–R4 da auditoria no PR #1.
