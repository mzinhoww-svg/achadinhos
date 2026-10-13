# 001 — Fila de envios
Status: aceita (orquestrador, pendente de parecer do Planejador)
## Opções
1. **pg-boss**: pronto, retries e cron, mas modelo próprio de job duplica o estado de `sends`, controle fino de "1 por canal + 60 s" exige gambiarra.
2. **Tabela própria `sends` com `FOR UPDATE SKIP LOCKED`**: o próprio send é o job; a regra de canal/intervalo/teto entra na query de claim; histórico só de inserção natural; sem dependência extra.
3. Redis/BullMQ: nova infra e custo, descartada.
## Decisão
Opção 2. Claim atômico por canal (advisory lock por channel_id + SKIP LOCKED), `sending` com lease, jobs idempotentes por (group_id, offer_id).
## Riscos
Lease expirado após crash (reaper marca failed com motivo; sem retry). Testar 2 workers concorrentes.
