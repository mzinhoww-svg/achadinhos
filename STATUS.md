# STATUS
**Atualizado:** 2026-10-17 (main `321bddc`). **Escopo vigente:** `docs/plans/escopo-sem-supabase-telegram.md`.

## Fase atual
Gerador de ofertas **sem persistência**: Shopee (simulada) → `pnpm outbox:gerar` → pasta `outbox/` (um `.md` e um `.png` por oferta, mais `index.md` do dia). O WhatsApp entra depois pela mesma interface `Channel`.
**Fora do escopo agora:** Telegram, Supabase (banco, Vault, RLS, Realtime), e-mail e qualquer persistência (SQLite incluído). O código dessas partes continua no repositório, **dormente** (revalidado no workflow `dormente.yml`, sob demanda e semanal; não bloqueia PR).

## Na main (caminho ativo)
- `packages/shopee`: cliente GraphQL assinado + servidor simulado + sonda real (`pnpm shopee:live-check`) + diagnóstico do `10010` (`pnpm shopee:diag --degrau D0`, só D0 implementado).
- `packages/channel`: interface `Channel` e `FileOutbox` (T7-A).
- `apps/worker/src/gerar`: gerador e CLI `pnpm outbox:gerar` (T7-B), com guarda de chamada real (`--permitir-real` + `--limite` obrigatório; endpoint fora de loopback é recusado).
- `apps/web`: painel só com o container em memória, **demonstração local** (`ACHADINHOS_DEMO_SESSION=1`); `/conexoes` atrás de `ACHADINHOS_CONEXOES` (T8-A).
- Código dormente isolado (T7-C): `exclude` de tsconfig, `include` do vitest do worker, filtros `pnpm` na raiz.

## Credencial Shopee: NÃO validada
- A API real (`https://open-api.affiliate.shopee.com.br/graphql`) responde HTTP 2xx, mas recusa o documento `productOfferV2` com erro GraphQL **`10010`** (parse). Sonda real de 2026-10-16: 1 chamada.
- D0 (`{ __typename }`): 1 chamada, OK. Prova que o envelope e o transporte funcionam; **não** prova credencial nem assinatura. O D4 (Secret sentinela inválido) é o que decide isso.
- Nenhuma chamada real nova está autorizada. Cada rodada exige autorização de Aurimar com o número exato de chamadas por degrau.
- O cliente de produção não deve ser usado contra a API real até o documento ser corrigido (decisão em `docs/decisions/004-endpoint-shopee.md`).

## Decisões
001 fila e 003 hospedagem do worker: **suspensas** (dependiam de Postgres/VPS). 002 criativo (Satori+Resvg): **vigente**. 004 endpoint Shopee: URL confirmada por resposta real; credencial e formato do documento pendentes.

## Orçamento
Teto de R$ 100/mês **suspenso**: sem Supabase, Vercel, VPS nem e-mail no escopo atual. Nenhum gasto realizado.

## Aguardando Aurimar
1. Autorizar (ou não) a rodada de diagnóstico D1 + D4 (2 chamadas; o D4 com autorização própria).
2. Perguntas do plano (§7): (1) automações em arquivo de configuração só-leitura? (2) o painel web continua? (3) pasta da outbox; (4) transporte do WhatsApp decidido depois, checando termos e risco de banimento.

## Falta para o MVP de ponta a ponta
Lista priorizada e dependências em `docs/mvp-checklist.json` (campo `mvp_falta`). Resumo: credencial/documento Shopee validados; T7-D (automações em arquivo); T8-B (Mandar agora → gerador, só se o web continuar); e2e do CLI contra a Shopee simulada com criativo real; README do CLI reproduzível do zero; WhatsApp depois, com gate próprio.
