# 001 — Fila de envios
Status: aceita com ajustes (parecer do Planejador em 2026-10-13: ver final do arquivo; ajustes A1–A9 viram requisitos de T2/F2)
## Opções
1. **pg-boss**: pronto, retries e cron, mas modelo próprio de job duplica o estado de `sends`, controle fino de "1 por canal + 60 s" exige gambiarra.
2. **Tabela própria `sends` com `FOR UPDATE SKIP LOCKED`**: o próprio send é o job; a regra de canal/intervalo/teto entra na query de claim; histórico só de inserção natural; sem dependência extra.
3. Redis/BullMQ: nova infra e custo, descartada.
## Decisão
Opção 2. Claim atômico por canal (advisory lock por channel_id + SKIP LOCKED), `sending` com lease, jobs idempotentes por (group_id, offer_id).
## Riscos
Lease expirado após crash (reaper marca failed com motivo; sem retry). Testar 2 workers concorrentes.

## Parecer do Planejador (Farol) — 2026-10-13
**Veredito: ACEITA COM AJUSTES.** A opção 2 está certa (o `send` é o job; sem segundo modelo de estado). O desenho abaixo fecha as lacunas de idempotência, exclusividade por canal, lease e fuso. Cada ajuste tem teste de aceite no plano da fase 2 (F2-06 a F2-09).

### Ajustes obrigatórios
- **A1 — Chave de idempotência não pode ser (group_id, offer_id) permanente.** A antirrepetição vale 7 dias; uma unique permanente impediria reenviar a mesma oferta depois disso. Usar `idempotency_key` = `automation_id:group_id:slot` (slot = início do tick, em UTC, truncado à frequência), com `unique (account_id, idempotency_key)` e `INSERT ... ON CONFLICT DO NOTHING`. A regra de 7 dias continua sendo consulta de dedupe (índice já previsto no PRD), não constraint.
- **A2 — Exclusividade 1-por-canal garantida pelo banco, não só por advisory lock.** Criar `unique index on sends (channel_id) where status = 'sending'`. O advisory lock (`pg_try_advisory_xact_lock`, escopo de transação) serializa o claim e evita corrida na checagem de intervalo/teto; o índice parcial é a rede de segurança: se qualquer código errar, o segundo `sending` falha em vez de enviar em dobro. Proibido lock de sessão (pooler do Supabase em modo transação).
- **A3 — Claim em uma única função SQL (RPC) atômica**, `claim_next_send(channel_id)`: (1) advisory lock xact; (2) reaper do canal; (3) nega se há `sending` vivo, se `now() - último finished_at < 60 s` ou se o teto do dia local foi atingido; (4) seleciona `queued` por `priority desc, scheduled_for asc` com `FOR UPDATE SKIP LOCKED`; (5) marca `sending`, `lease_expires_at = now() + lease`, `attempted_at = now()`. Tempo sempre `now()` do banco, nunca o relógio do worker. `EXECUTE` revogado de anon/authenticated.
- **A4 — Lease e reaper.** Lease = 120 s (cobre download da imagem + render + Telegram, cada um com timeout próprio menor). Reaper roda no início de cada claim e a cada tick: `sending` com `lease_expires_at < now()` vira `failed` com `reason = 'lease_expirado_resultado_desconhecido'`. Sem retry (regra do PRD), porque o envio pode ter chegado ao Telegram.
- **A5 — At-most-once explícito para o caso "enviou mas não gravou".** Se o worker cai depois do `sendPhoto` e antes de gravar `sent`, o reaper marca `failed` e o índice de dedupe (`where status='sent'`) não enxerga a linha, então o mesmo item pode voltar ao grupo antes de 7 dias. Ajuste: a consulta de dedupe considera `sent` **e** `failed` com `reason = 'lease_expirado_resultado_desconhecido'`. Falha limpa (erro de API antes do envio) não bloqueia.
- **A6 — Teto de 200 por canal/dia no fuso da conta.** O dia é `date_trunc('day', now() AT TIME ZONE accounts.timezone)`; contam `sending` + `sent` + `failed` com `attempted_at` preenchido (tentativa gasta cota do Telegram). Zerar à 00:00 local de America/Cuiaba, não UTC. Índice `(channel_id, attempted_at)`.
- **A7 — Fuso por IANA, nunca offset fixo.** Cuiabá hoje é UTC−4 sem horário de verão, mas o código usa `America/Cuiaba` via `AT TIME ZONE`/Temporal, para não quebrar se a regra mudar ou se outra conta usar outro fuso. Banco guarda `timestamptz` (UTC).
- **A8 — Virada de dia e janela que cruza a meia-noite.** (a) Janela `window_start > window_end` (ex.: 22:00–02:00) pertence ao dia de início para fins de `days`. (b) Um `queued` cujo `scheduled_for` caiu dentro da janela mas é reclamado depois do fim dela vira `skipped` com `reason = 'fora_da_janela'` (exceto prioridade 100). (c) O teto reinicia à 00:00 local; envios na fila antes da meia-noite que saem depois contam no dia novo (pelo `attempted_at`). Testar com relógio simulado em 23:59:30, 00:00:00 e 00:00:30 de Cuiabá.
- **A9 — Tick idempotente.** O agendador seleciona `automation_groups` vencidos com `FOR UPDATE SKIP LOCKED`, insere o `send` e avança `next_run_at` **na mesma transação**. Dois workers (ou um deploy com sobreposição) não geram dois envios. Não empilhar: se já existe `queued` da mesma automação+grupo, não enfileirar outro.

### Pontos para decisão de Aurimar (não bloqueiam T2)
1. **"Mandar agora" ignora a antirrepetição de 7 dias?** Recomendo: sim, porque é ação manual explícita, mas respeitando 1-por-canal e o teto. O PRD não diz.
2. **Comissão "só de inserção"** conflita com o `conversionReport` atualizar o status do mesmo `checkout_id`. Recomendo upsert por `checkout_id` com histórico em tabela de eventos, ou aceitar update só da coluna de status.

### Riscos residuais aceitos
Pode haver mensagem enviada com `failed` no histórico (A5 mitiga a repetição, não o registro). Falha sem retry perde a postagem daquele slot; é a regra do PRD.
