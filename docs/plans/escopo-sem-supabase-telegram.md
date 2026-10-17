# Plano — escopo sem Supabase, Telegram, e-mail e persistência

Autor: Planejador. Data: 2026-10-16. Origem: mudança de escopo e correção de Aurimar no mesmo dia.
**Nada foi implementado nem apagado.** Este plano só reorganiza o que fica, o que dorme e o que Dev OpenCode faz a seguir.

## 0. Escopo novo, em uma frase

Ofertas da Shopee viram **arquivos numa pasta local de análise** (`outbox/`, gitignored). **Nada é guardado**: sem banco, sem SQLite, sem arquivo de estado; os próprios arquivos da outbox são o único rastro. Depois Aurimar conecta um WhatsApp e o orquestrador liga um adaptador ao mesmo `Channel`.

Decisões anteriores que este escopo **suspende** (não revoga o raciocínio, só o torna dormente): infra Supabase + Vercel + VPS e teto de R$ 100 (`docs/plans/deploy.md`, decisão 003), fila SQL (decisão 001), Vault/RLS, Telegram, alertas por e-mail. Custo esperado agora: R$ 0. O PRD ("WhatsApp fora do escopo, só o campo kind") fica desatualizado; a T7-C (§6) acrescenta um aviso de "suspenso/desatualizado" no topo de `prd.md`, `deploy.md` e das decisões 001 e 003, sem apagar o texto.

## 1. Interface `Channel` e adaptador `FileOutbox`

Pacote novo `packages/channel` (sem dependência de Shopee, Telegram ou banco).

```ts
/** Identidade do envio. É a MESMA coisa que o nome do arquivo (B1): nada mais entra no caminho. */
export interface Slot {
  day: string;        // AAAAMMDD, fuso America/Cuiaba, calculado UMA vez por execução
  hhmm: string;       // HHMM, mesmo relógio e mesmo instante (início da execução)
  groupIndex: number; // 1..99, posição do grupo na configuração; nunca o rótulo externo
}
export interface OutboundOffer {
  slot: Slot;
  itemId: string;           // só dígitos (^[0-9]{1,20}$)
  title: string;            // dado externo: nunca vira nome de arquivo
  text: string;             // mensagem pronta; também dado externo (ver regra 4)
  affiliateLink: string;    // https, host em AFFILIATE_LINK_HOSTS
  priceCurrent: number; priceOld: number; discountPct: number; // finitos, >= 0; discountPct <= 100
  creativePng: Uint8Array;  // 1080x1080, <= MAX_CREATIVE_PNG_BYTES
  generatedAtUtc: string;   // ISO 8601 UTC; só dentro do front matter
  groupLabel: string;       // rótulo de exibição; nunca em caminho
}
export type DeliveryResult =
  | { status: "delivered"; ref: string }      // ref: caminho relativo (FileOutbox) ou id da mensagem (WhatsApp)
  | { status: "failed"; code: string }        // nada confirmado; código fixo, nunca mensagem de erro
  | { status: "unknown"; code: string };      // pode ter entregue (timeout); NUNCA reenviar sozinho
export interface Channel {
  readonly kind: "file-outbox" | "whatsapp";
  deliver(offer: OutboundOffer, opts: { signal: AbortSignal }): Promise<DeliveryResult>;
}
```

**Fonte única de tempo (B1).** O gerador (T7-B) calcula `day` e `hhmm` **uma vez**, no início da execução, com `getZonedParts(runStartedAt, DEFAULT_TIMEZONE)` de `packages/domain/src/timezone.ts`, e usa o mesmo `Slot` em todas as ofertas da execução. Assim uma execução que cruza a meia-noite grava tudo na pasta do dia em que começou. O `channel` **não calcula tempo**: só valida o formato (`^[0-9]{8}$`, `^[0-9]{4}$`, inteiro 1–99). UTC aparece apenas em `generatedAtUtc` (dentro do arquivo).

**Constantes compartilhadas (B3).** `packages/channel/src/limits.ts` exporta `AFFILIATE_LINK_HOSTS = ["shopee.com.br", "shp.ee", "shope.ee", "s.shopee.com.br"]`, `MAX_LINK_LENGTH = 300` e `MAX_CREATIVE_PNG_BYTES = 5_000_000`, e a função `isAllowedLink` (https, sem credenciais, host exato ou subdomínio). Os hosts e `MAX_LINK_LENGTH` são cópia de `apps/worker/src/links.ts` (ativo); `MAX_CREATIVE_PNG_BYTES = 5_000_000` é o valor de `MAX_IMAGE_BYTES` em `sql/build-deps.ts`, que é dormente e não exportado, então **não há paridade para ele** (o `channel` passa a ser a fonte). O `channel` **não importa de `apps/worker`**. O teste `apps/worker/tests/paridade.test.ts` importa `links.ts` e `@achadinhos/channel` e falha se `DEFAULT_SHOPEE_LINK_HOSTS`/`MAX_LINK_LENGTH` divergirem, ou se `isAllowedLink` der resultado diferente num conjunto fixo de URLs.

`unknown` reaproveita a regra de `packages/domain/src/unknown-result.ts`: resultado incerto não é reenviado. O FileOutbox quase nunca o produz; existe para o WhatsApp.

**FileOutbox** (agora):

```
outbox/                                  raiz: OUTBOX_DIR (padrão ./outbox); `outbox/` entra no .gitignore já neste PR
  20261016/                              slot.day
    index.md                             tabela do dia, reconstruída listando a pasta (derivado, não é estado)
    1432-123456789-g1.md                 <hhmm>-<itemId>-g<groupIndex>; marcador de "entregue"
    1432-123456789-g1.png                criativo ao lado
```

`slotKey` = `<day>/<hhmm>-<itemId>-g<groupIndex>`: é, ao mesmo tempo, a chave de idempotência e o caminho (sem extensão). Dois grupos com o mesmo item no mesmo minuto geram **dois** arquivos (`-g1`, `-g2`).

Regras do adaptador (viram testes hostis):
1. **Nome de arquivo só de campos controlados** (`day`, `hhmm`, `itemId`, `groupIndex` validados por regex). Título, rótulo do grupo e qualquer texto da Shopee nunca entram em caminho.
2. **Raiz e permissões**: a raiz resolvida tem de estar dentro de `OUTBOX_DIR`; pasta `0700`, arquivos `0600`; symlink na pasta do dia (ou em qualquer arquivo do slot) é recusado.
3. **Ordem de escrita e marcador de commit (B2)**: (a) grava o PNG em `.<nome>.<sufixo>.png.tmp` (flag `wx`) e faz `rename` para o nome final (sobrescrever PNG órfão é permitido: o criativo é função determinística da oferta); (b) **por último**, grava o `.md` em `.<nome>.<sufixo>.md.tmp` (flag `wx`) e publica com `link(tmp, final)` + `unlink(tmp)`, que **falha com `EEXIST` se o `.md` já existir** (sem sobrescrita silenciosa). O `.md` é o único marcador de "entregue". **Nome do temporário (achado B1 do QA no reteste do #43/#45)**: `<sufixo>` é **aleatório por tentativa** (`crypto.randomUUID()`, ou `randomBytes(8).toString("hex")`), **nunca** `pid` nem contador, porque o `pid` é igual para tudo no mesmo processo e duas instâncias do adaptador (ou o gerador e um teste) colidiriam no mesmo temporário. O temporário é criado com `flag: "wx"` (falha se já existir) e removido em caso de erro.
4. **Idempotência e corrida**: antes de qualquer escrita, se o `.md` do slot existe, devolve `delivered` com o mesmo `ref` sem tocar em nada. Se duas execuções passam na checagem ao mesmo tempo, `link` deixa **um** vencedor; o perdedor recebe `EEXIST` e devolve `delivered` com o `ref` do vencedor. PNG sem `.md` (falha entre os passos) **não** é "entregue": a reexecução regrava o PNG e o `.md`. Falha no PNG → `failed` `escrita_png`; falha no `.md` → `failed` `escrita_md`; o PNG órfão é inofensivo e o `index.md` lista só slots com `.md`. A idempotência vale **dentro do mesmo minuto** (o `hhmm` faz parte da chave); reexecução um minuto depois grava outro slot — não é proteção de antirrepetição.
5. **Texto externo neutralizado (título e `text`)**: remove controles C0/C1, `\r`, `\n` (vira espaço **no título**; no `text` o `\n` é preservado, porque dentro do bloco cercado não fecha o bloco e a mensagem do WhatsApp pode ter linhas), U+2028 e U+2029, U+202A–U+202E e U+2066–U+2069; teto de 500 caracteres para o título; escapa `\`, `` ` ``, `|`, `[`, `]`, `<`, `>`, `*`, `_` e linhas que comecem com `---`, `#` ou `>`. O `text` (mensagem pronta para copiar) **não** é escapado: vai dentro de um bloco de código cercado (fence de crases com tamanho = maior sequência de crases do texto + 1, mínimo 3), depois de remover controles, separadores e bidi, para a cópia sair literal (sem `\*` nem `\_`) e ainda assim não virar estrutura. O mesmo escape vale para o título dentro do corpo do `.md` e para a célula do `index.md` (a tabela só tem `|` nossos). Front matter por `JSON.stringify` **após** remover U+2028/U+2029 (alguns parsers YAML os tratam como quebra de linha).
6. **Link**: `isAllowedLink(affiliateLink, AFFILIATE_LINK_HOSTS)` antes de qualquer escrita; falha → `failed` `link_invalido`. O link gravado em **qualquer** lugar do `.md` (front matter e corpo) é o normalizado (`new URL(...).href` sem controles), nunca o texto cru recebido.
7. **Números**: `priceCurrent`, `priceOld`, `discountPct` precisam ser finitos e ≥ 0, `discountPct ≤ 100`; senão `failed` `oferta_invalida` (NaN/Infinity/negativo nunca viram texto copiável).
8. **PNG**: ≤ `MAX_CREATIVE_PNG_BYTES` e assinatura PNG (`89 50 4E 47 0D 0A 1A 0A`); senão `failed` `png_invalido`.
9. **Sem segredo na outbox**: App ID, Secret, header de assinatura e corpo bruto da API nunca são gravados. Temporários (`.`-prefixados) são ignorados pelo `index.md`.

**Adaptador WhatsApp (depois, não agora)**: implementa o mesmo `Channel`; o resto do pipeline não muda. Antes de ligar, condições de entrada: (a) Aurimar autoriza o primeiro envio real (regra já declarada); (b) antirrepetição e limite de ritmo existem de alguma forma, porque sem eles um erro repete mensagens num grupo real; (c) escolha do transporte registrada em decisão: automação não oficial de WhatsApp costuma violar termos e arrisca banir o número, e a API oficial pode não cobrir envio a grupo (confirmar na documentação antes de decidir).

## 2. O que acontece com o código atual

Princípio: **isolar, não apagar** (histórico fica no git e no repo). "Dormente" = continua no repo, com README de aviso, fora do caminho de execução e da CI padrão.

| Código | Destino | Detalhe |
|---|---|---|
| `packages/shopee`, `packages/creative`, `packages/domain` (estimativa, fuso, filtros, `unknown-result`) | **Mantém, é o núcleo** | `shopee` testado só contra o servidor simulado até o diagnóstico do 10010 (PR #42) |
| `apps/worker/src/{offer-selection,links,image}.ts` (seleção, host de link, downloader seguro de imagem) | **Mantém e reaproveita** | base do gerador novo |
| `apps/worker/src/executor.ts`, `ports.ts`, `runtime.ts`, `main.ts`, `heartbeat*`, `scheduler.ts` (não `scheduler-ports.ts`) | **Dormente** | acoplados a `ClaimedSend`, lease, `finish_send`, Telegram |
| `apps/worker/src/sql/*`, `validation/*`, `commission-job.ts` | **Dormente** | Postgres, Vault, validação de token |
| `packages/telegram` | **Dormente** | fora do `typecheck`/`test` padrão (filtro do pnpm); dependências **permanecem** em `package.json` para a suíte dormente continuar rodando |
| `packages/alerts` (e-mail) | **Dormente** | idem; substituído por resumo no terminal e código de saída |
| `packages/commission` | **Núcleo puro mantém; `sql/` dormente** | coleta adiada (§4) |
| `supabase/` (migrações, testes de banco) | **Dormente, intacto** | job de banco sai da CI padrão e roda no workflow dormente (abaixo) |
| `apps/web/src/server/supabase/*`, `realtime*`, `telegram-gateway.ts`, `/conexoes` | **Dormente** | o web já tem container em memória (`server/memory.ts`); passa a ser o único usado |
| Vault, RLS, Realtime | **Dormente** | credencial Shopee passa a vir de variável de ambiente |

**Como o dormente é isolado sem apagar e sem apodrecer (B3).** Mecanismo único, executado na T7-C:
- **Dependências não são removidas** de nenhum `package.json`: o código dormente continua compilando e testável.
- `apps/worker/tsconfig.json` **e `apps/worker/tsconfig.test.json`** (o `typecheck` do worker roda os dois; o segundo inclui `src` + `tests`) ganham `exclude` com: `src/executor.ts`, `src/ports.ts`, `src/runtime.ts`, `src/main.ts`, `src/bin.ts`, `src/index.ts`, `src/heartbeat*.ts`, `src/scheduler.ts`, `src/memory-store.ts`, `src/commission-job.ts`, `src/timeouts.ts`, `src/config.ts`, `src/sql/**`, `src/validation/**`. **Ficam ativos (fecho de imports conferido na T7-C):** `offer-selection.ts`, `deadline.ts` (folha de uma função), `scheduler-ports.ts` (só tipos; importa apenas `@achadinhos/shopee` e `@achadinhos/domain`), `links.ts`, `image.ts`, `logger.ts` e a pasta nova `gerar/`. Atenção: o glob `src/scheduler*.ts` **não** pode ser usado, porque pegaria `scheduler-ports.ts`.
- `apps/worker/vitest.config.ts` usa **`include` explícito** (allowlist), não `exclude`: `tests/image.test.ts`, `tests/logger.test.ts`, `tests/scheduler/offer-selection.test.ts` (com seu `tests/scheduler/helpers.ts`), `tests/links.test.ts` (novo, ver T7-C), `tests/paridade.test.ts` (novo) e `tests/gerar/**`. Todo o resto (hoje o restante dos 339 testes) é dormente. Teste novo que não esteja na allowlist não roda na CI padrão: quem cria o teste inclui a linha.
- **Se um arquivo ativo importar um excluído, a T7-C para e avisa o Planejador** (não improvisa, não move código).
- Raiz: `typecheck` e `test` passam a usar `pnpm -r --filter '!@achadinhos/telegram' --filter '!@achadinhos/alerts'`; `packages/commission/src/sql/**` sai por `exclude`; `apps/web` segue na CI padrão até a T8-A.
- **Revalidação do dormente**: configs `tsconfig.dormente.json`/`vitest.dormente.config.ts` (sem os `exclude`) e o workflow `.github/workflows/dormente.yml` com `workflow_dispatch` **e** `schedule` semanal, rodando typecheck e a suíte dormente (o job de banco `supabase test db` entra aqui). Falha do workflow dormente não bloqueia PR, mas aparece no painel. Assim o dormente apodrece com alarme, e o README deixa de ser a única defesa (R5).

**Segredos sem Vault**: `SHOPEE_APP_ID` e `SHOPEE_SECRET` só em `.env` (gitignored, modo 0600) ou no ambiente do shell. O logger com redação continua obrigatório; a sonda e o gerador seguem o allowlist de saída do PR #41/#42. Perde-se a separação "só o worker lê o segredo": como é uso próprio e local, o risco aceito é "quem lê a máquina lê o `.env`". Registrar isso em `docs/security-checklist.md` quando o item 2 fechar.

## 3. Fluxo novo (sem estado)

`CLI sob demanda` → busca ofertas (`productOfferV2`) → filtra → **dedupe só dentro do lote, em memória** → `generateShortLink` com subIds → baixa imagem (downloader seguro) → criativo PNG → `Channel.deliver` → resumo.

- Sem laço, sem agendador, sem retry (falha de oferta vira código fixo e a execução segue para a próxima).
- **Teto por execução** (`--limite`, padrão 10, máximo 50) no lugar do teto diário por canal.
- Saída do terminal: por oferta, só `slotKey` e `delivered|failed|unknown` + código; resumo no fim; exit code ≠ 0 se alguma falhar.
- Real na Shopee só depois que Aurimar autorizar rodada de diagnóstico e o item 2 validar; até lá, tudo contra o servidor simulado.

## 4. Adiado (depende de armazenamento)

| Item | Por quê | Reabrir quando |
|---|---|---|
| Antirrepetição de 7 dias (7) | precisa lembrar o que já saiu | persistência decidida, **e antes de ligar o WhatsApp** |
| Fila 1/canal, 60 s, teto 200/dia (8) | claim, lease e contadores são estado | WhatsApp real (limite de ritmo) |
| Comissão por grupo, job de 6 h (12) | precisa guardar `checkout_id` e somar | persistência decidida |
| Agendador por janela/frequência (6) | sem estado repete oferta a cada reinício | junto com a antirrepetição |
| Histórico e Realtime de envios (11), alertas por e-mail e heartbeat (13) | dependem de banco/e-mail | persistência / canal real |

## 5. Checklist do MVP revisado (itens pedidos)

Itens 1, 5 e 9 não mudam.

| # | Antes | Agora | Aceite novo | Status |
|---|---|---|---|---|
| 2 | Validar e salvar App ID/Secret (Vault) | Credencial Shopee por env, validada pela sonda | Nenhum arquivo, log ou saída contém o Secret; **uma** chamada `productOfferV2` do cliente de produção devolve ≥ 1 oferta | **bloqueado** pelo 10010 (#42) |
| 3 | Canal Telegram | **Canal FileOutbox** (Telegram removido do MVP) | Dada uma oferta, gera `.md` + `.png` + `index.md`; testes hostis do §1 passam | pendente (T7-A) |
| 4 | Automações CRUD, limite 5 | Automações lidas de arquivo de configuração só-leitura (a confirmar, §7) | Validação de limite 5 e filtros testada; CRUD de tela adiado | pendente (T7-D, depende de resposta) |
| 6 | Agendador por minuto | **Adiado** | — | adiado |
| 7 | Antirrepetição 7 dias | **Adiado**; dedupe só dentro do lote | Lote nunca repete `item_id` | adiado (parte em memória em T7-B) |
| 8 | Fila/ritmo/teto 200 | **Adiado**; teto por execução | `--limite` máx. 50 respeitado | adiado |
| 10 | Mandar agora (e2e simulada) | **Gerar agora** (CLI → outbox) | E2E com Shopee simulada: N ofertas → N pares `.md`/`.png` + índice; reexecução **no mesmo minuto** não duplica (um minuto depois grava outro slot: isto não é antirrepetição) | pendente (T7-B); é o item central |
| 11 | Envios: cards, 30 dias, Realtime | `index.md` do dia | Índice lista as entregas do dia e resiste a título hostil | coberto por T7-A |
| 12 | Comissão a cada 6 h | **Adiado** | — | adiado |
| 13 | Alertas por e-mail | **Adiado**; resumo no terminal e exit code | Execução com falha sai ≠ 0 | coberto por T7-B |
| 14 | Onboarding e estados vazios | Web fora do caminho crítico; README de uso da CLI | README reproduzível do zero; QA visual só se o web continuar (§7) | reduzido |

## 6. Tarefas reescritas para Devs OpenCode

Cada tarefa: worktree e branch próprios, PR pequeno, `TASKS.md` → `em_revisao` com PR e evidência, **sem chamada real à Shopee** (só servidor simulado), segredos nunca em log/PR. Instruções explícitas para modelo menor: não mexer em arquivos fora da lista, não apagar nada dormente, rodar `pnpm typecheck && pnpm test` antes do PR.

**T7-A — `packages/channel` (interface + FileOutbox)**. Cria o pacote com os tipos do §1 e o adaptador. Arquivos: só `packages/channel/**` (a linha `outbox/` do `.gitignore` já vem deste PR de plano). Entrega `limits.ts` (§1) e o adaptador. Aceite: testes para (1) título com `../`, `\n`, `---`, `|`, `[x](http://...)`, 10 000 caracteres e emoji; (2) `itemId` não numérico recusado; (3) link fora da allowlist recusado; (4) mesmo `slotKey` duas vezes → um arquivo só; (5) arquivo `0600`, pasta `0700`; (6) symlink na pasta do dia recusado; (7) `index.md` correto após 3 entregas, com título hostil (`|`, crase, U+2028/U+2029, `---`); (8) **dois grupos, mesmo item e mesmo minuto → 2 arquivos** (`-g1`, `-g2`); (9) `Slot` cruzando a virada de dia: duas ofertas da mesma execução ficam na mesma pasta; (10) **falha forçada após o PNG e antes do `.md`** → `failed`, reexecução conclui e só então há `.md`; (11) **duas instâncias** de `createFileOutbox` com o **mesmo `dir`** e **20 `deliver` concorrentes do mesmo slot** (metade em cada instância) → 20 `delivered` com o mesmo `ref`, nenhum `failed`, e na pasta só `index.md`, `<base>.md` e `<base>.png` (sem `.tmp` restante); um teste de uma instância só **não** satisfaz o aceite; (12) `NaN`, `Infinity`, negativo e `discountPct` > 100 recusados; (13) PNG sem assinatura ou acima do limite recusado; (14) `.md` já existente nunca é sobrescrito.

**T7-B — gerador e CLI `pnpm outbox:gerar`**. Em `apps/worker/src/gerar/`: função pura com portas (`OfferSource`, `ShortLinker`, `ImageFetcher`, `RenderCreative`, `Channel`), reaproveitando `offer-selection.ts`, `links.ts`, `image.ts` e `@achadinhos/creative`. Calcula o `Slot` **uma vez** por execução (§1) e importa `AFFILIATE_LINK_HOSTS`/`MAX_CREATIVE_PNG_BYTES` de `@achadinhos/channel`. Dedupe só do lote; `--limite`; sem laço/retry; saída conforme §3. Inclui o teste de paridade com `apps/worker/src/links.ts` (e só ele; ver §1). Aceite: e2e com o servidor Shopee simulado (N ofertas → N pares + índice; uma falha de imagem não derruba as outras; exit code); teste de que nenhum arquivo nem linha de log contém o Secret.

**T7-C — isolar o dormente**. Segue **exatamente** o mecanismo do §2 ("Como o dormente é isolado"): `exclude` no `tsconfig` e no `vitest` do worker, filtros do `pnpm` na raiz, configs e workflow dormentes, README "DORMENTE: ver docs/plans/escopo-sem-supabase-telegram.md" em cada pasta listada, e aviso de "suspenso/desatualizado" no topo de `prd.md`, `deploy.md` e das decisões 001 e 003 (sem apagar o texto). Cria também `apps/worker/tests/links.test.ts` (https obrigatório, credenciais embutidas recusadas, host exato e subdomínio aceitos, host parecido recusado, tamanho > 300 recusado), porque hoje nenhum teste cobre `links.ts`. **Não remove dependência nenhuma nem apaga arquivo.** Antes de excluir, a T7-C confere o fecho de imports do conjunto ativo; se achar outro conflito, para e avisa. Aceite: `pnpm install && pnpm typecheck && pnpm test` verdes sem Docker e sem Supabase CLI; o workflow dormente roda verde (`workflow_dispatch`) com a suíte completa; `git diff --stat` sem deleções de código; a contagem de testes do worker antes/depois está no PR (ativos + dormentes = total anterior).

**T7-D — automações por arquivo (só depois da resposta 1 do §7)**. `config/automacoes.json` (sem segredo, versionado ou não conforme a resposta), carregado e validado por `packages/domain/src/automation.ts` (limite 5, filtros). Aceite: arquivo inválido falha fechado com código fixo; 6ª automação recusada.

**T8-A — desacoplar o web**. `apps/web` usa só o container em memória; `/conexoes` e telas de Telegram somem do menu (rotas preservadas atrás de flag); build e testes verdes. Aceite: `pnpm --filter web build` e testes verdes sem variáveis do Supabase.

**T8-B — "Mandar agora" do web chama o gerador (opcional, só se Aurimar mantiver o web)**. Server action local que invoca T7-B e mostra o caminho da outbox. Aceite: clique gera os arquivos; nada de segredo no payload RSC. Bloqueada até a resposta 2 do §7.

Ordem: T7-A e T7-C em paralelo → T7-B → T7-D → T8-A → T8-B. O diagnóstico do 10010 (#42) corre à parte e é pré-requisito só do item 2 e da primeira execução real.

## 7. Perguntas para Aurimar

1. **Automações** (filtros, janela, cabeçalho/rodapé, limite 5) podem viver num arquivo de configuração só-leitura editado à mão? Não é estado, mas é um arquivo que o programa lê.
2. **O painel web continua?** Se sim, T8-A/B; se não, o MVP é só a CLI e a pasta.
3. **Onde fica a outbox?** Padrão `./outbox` dentro do repo (gitignored), ou outra pasta (por exemplo uma que você abra direto no Finder)?
4. **WhatsApp**: aceita que o transporte seja decidido numa decisão própria, depois de checar os termos e o risco de banimento do número?

## 8. Riscos

- **R1** Título/URL da Shopee forja conteúdo ou caminho → regras 1, 4 e 5 do §1, com testes hostis.
- **R2** Sem antirrepetição, execuções seguidas geram ofertas repetidas na pasta → aceitável para análise; **bloqueia** o WhatsApp (§1, condição b).
- **R3** Segredo em `.env` sem Vault → §2; `.env` 0600, redação de log, allowlist de saída.
- **R4** Primeira chamada real depende do diagnóstico do 10010; o MVP pode ficar totalmente "verde no simulado" sem provar a Shopee real. O item 2 continua sendo o gate honesto.
- **R5** Isolar sem apagar deixa código morto que pode voltar a ser importado por engano → README de aviso e CI sem esses pacotes no caminho padrão.
