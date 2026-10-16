> **SUSPENSO / DESATUALIZADO (2026-10-16).** A fila SQL (tabela `sends` + `SKIP LOCKED`) está
> suspensa pelo escopo sem persistência (`docs/plans/escopo-sem-supabase-telegram.md`, §2 e §4).
> O texto e o parecer abaixo ficam preservados como histórico; nada foi apagado.

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

### Revisão após QA do PR #3 (2026-10-13): modelo de mutação de `sends` e enfileiramento
**M1 — "Insert-only" de `sends` passa a ter definição operacional** (o texto literal do PRD é incompatível com claim/lease/`finish_send` e com `ON DELETE` das FKs; reproduzido pelo QA no PR #4):
- **Colunas de identidade, imutáveis após o INSERT:** `id`, `account_id`, `idempotency_key`, `priority`, `scheduled_for`, `created_at`, e as referências `offer_id`, `group_id`, `channel_id` (estas só podem mudar para `NULL`, por ação de FK).
- **Colunas de execução, mutáveis apenas por RPC `SECURITY DEFINER` do worker** (`claim_next_send`, `finish_send`, reaper): `status`, `reason`, `lease_expires_at`, `attempted_at`, `finished_at`, `sent_at`, `external_message_id`, `short_link`, `creative_url`, `message_text`.
- **Histórico:** nenhum `DELETE` direto e transições só para frente (`queued→sending→sent|failed|skipped`; `queued→skipped`); cada transição gera linha em `send_status_events` (só inserção).
- **Substituir `send_immutable_guard`** (PR #4) por um guard que compara `OLD` e `NEW` coluna a coluna e **não** usa GUC liberável pela sessão; `UPDATE`/`DELETE` revogados de `authenticated` (as RPCs rodam como dono). O guard deve **permitir** a anulação de `offer_id`/`group_id`/`channel_id` disparada por FK e o `DELETE` em cascata de `accounts` (exclusão de conta, LGPD), e **bloquear** qualquer outra mudança de identidade.
- **Preferência de produto:** grupo/oferta com histórico é desativado (`active=false`), não apagado; a exclusão física fica para a conta inteira.
- **Testes (pgTAP, como `authenticated` e como dono):** deletar grupo, oferta e conta com histórico não falha; alterar `priority`/`group_id` por cliente falha; transição `sent→queued` falha.

**M2 — "Mandar agora" é RPC, não INSERT direto.** `authenticated` **não** tem policy de INSERT em `sends`. `enqueue_send_now(group_id, offer_id)` (`SECURITY DEFINER`, `search_path` fixo) valida posse do grupo e da oferta pela sessão, força `status='queued'`, `priority=100` e gera `idempotency_key` (anti duplo clique); ignora qualquer outro dado do cliente. A prioridade 100 que fura a janela (A8b) só é obtida por essa RPC.

**M3 — Expressão do dia local (A6).** Para `tz = accounts.timezone`:
`inicio = (date_trunc('day', now() AT TIME ZONE tz)) AT TIME ZONE tz` e `fim = (date_trunc('day', now() AT TIME ZONE tz) + interval '1 day') AT TIME ZONE tz`; contar `attempted_at >= inicio AND attempted_at < fim`. (`date_trunc` sobre `timestamp` sem zona devolve `timestamp` sem zona; a conversão de volta com `AT TIME ZONE tz` é obrigatória.) Testes com `attempted_at` em UTC em 23:59:30 e 00:00:30 de Cuiabá.

**M4 — Dedupe e índices (A5).** O índice parcial `where status='sent'` do PRD/PR #4 não cobre o resultado desconhecido. Criar `(group_id, offer_id, attempted_at) where status='sent' or (status='failed' and reason='lease_expirado_resultado_desconhecido')` e, para corrida entre ordens, unique parcial `(group_id, offer_id) where status in ('queued','sending')`. A janela de `dedupe_days` fica na consulta do worker.

**M5 — Risco residual (A8b).** Com 1 envio/60 s e backlog, `queued` pode passar da janela e virar `skipped/fora_da_janela`: perde-se a postagem, sem retry (regra do PRD). Aceito; o teste F2-10/T7-10 mede quantos viram `skipped`.

**M6 — Comissão × insert-only (proposta; Aurimar decide).** `commissions` mantém PK `(account_id, checkout_id)`; o worker atualiza `status`/`estimated_commission` só por RPC de upsert idempotente, e cada mudança entra em `commission_events` (só inserção). Preserva o histórico exigido pelo PRD e resolve a atualização do `conversionReport`. Até Aurimar decidir, o schema do PR #4 **não** deve ser considerado final para `commissions`.
