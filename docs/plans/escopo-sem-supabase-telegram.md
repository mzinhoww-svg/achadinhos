# Plano — escopo sem Supabase, Telegram, e-mail e persistência

Autor: Planejador. Data: 2026-10-16. Origem: mudança de escopo e correção de Aurimar no mesmo dia.
**Nada foi implementado nem apagado.** Este plano só reorganiza o que fica, o que dorme e o que Dev OpenCode faz a seguir.

## 0. Escopo novo, em uma frase

Ofertas da Shopee viram **arquivos numa pasta local de análise** (`outbox/`, gitignored). **Nada é guardado**: sem banco, sem SQLite, sem arquivo de estado; os próprios arquivos da outbox são o único rastro. Depois Aurimar conecta um WhatsApp e o orquestrador liga um adaptador ao mesmo `Channel`.

Decisões anteriores que este escopo **suspende** (não revoga o raciocínio, só o torna dormente): infra Supabase + Vercel + VPS e teto de R$ 100 (`docs/plans/deploy.md`, decisão 003), fila SQL (decisão 001), Vault/RLS, Telegram, alertas por e-mail. Custo esperado agora: R$ 0. O PRD ("WhatsApp fora do escopo, só o campo kind") fica desatualizado; a T7-C (§6) acrescenta um aviso de "suspenso/desatualizado" no topo de `prd.md`, `deploy.md` e das decisões 001 e 003, sem apagar o texto.

## 1. Interface `Channel` e adaptador `FileOutbox`

Pacote novo `packages/channel` (sem dependência de Shopee, Telegram ou banco).

```ts
export interface OutboundOffer {
  slotKey: string;          // determinístico: AAAAMMDD-HHMM-<itemId>-<grupo>; chave de idempotência
  itemId: string;           // só dígitos (validado)
  title: string;            // dado externo: nunca vira nome de arquivo
  text: string;             // mensagem pronta (cabeçalho + título + preço + link + rodapé)
  affiliateLink: string;    // https, host em allowlist da Shopee
  priceCurrent: number; priceOld: number; discountPct: number;
  creativePng: Uint8Array;  // 1080x1080
  generatedAtUtc: string;   // ISO 8601 UTC
  groupLabel: string;       // rótulo de exibição; vira sub_id só no link, nunca no caminho
}
export type DeliveryResult =
  | { status: "delivered"; ref: string }      // ref: caminho relativo (FileOutbox) ou id da mensagem (WhatsApp)
  | { status: "failed"; code: string }        // nada entregue; código fixo, nunca mensagem de erro
  | { status: "unknown"; code: string };      // pode ter entregue (timeout); NUNCA reenviar sozinho
export interface Channel {
  readonly kind: "file-outbox" | "whatsapp";
  deliver(offer: OutboundOffer, opts: { signal: AbortSignal }): Promise<DeliveryResult>;
}
```

`unknown` reaproveita a regra de `packages/domain/src/unknown-result.ts`: resultado incerto não é reenviado. O FileOutbox quase nunca o produz; existe para o WhatsApp.

**FileOutbox** (agora):

```
outbox/                       raiz: OUTBOX_DIR (padrão ./outbox); caminho resolvido e checado
  2026-10-16/                 dia no fuso America/Cuiaba; horários dentro dos arquivos em UTC
    index.md                  tabela do dia, reconstruída listando a pasta (derivado, não é estado)
    1432-123456789.md         texto pronto para copiar + front matter
    1432-123456789.png        criativo ao lado
```

Regras do adaptador (viram testes hostis):
1. **Nome de arquivo só de campos controlados**: `HHMM` + `itemId` numérico. Título, grupo e qualquer texto da Shopee nunca entram em caminho (sem `../`, sem separador, sem Unicode estranho).
2. **Escrita atômica** (`tmp` + `rename`), diretório `0700`, arquivos `0600`. A raiz resolvida tem de ficar dentro de `OUTBOX_DIR`; symlink na pasta do dia é recusado.
3. **Idempotência**: se o `.md` do `slotKey` já existe, devolve `delivered` com o mesmo `ref` e não reescreve. Isso evita duplicata por reexecução do mesmo slot, sem guardar nada além dos arquivos. (Não substitui antirrepetição de 7 dias, que está adiada.)
4. **Front matter por `JSON.stringify`** (YAML válido); título é texto externo: remove controles/quebras, teto de 500 caracteres, `[ ] < >` e `---` escapados. Um título hostil não pode fechar o front matter nem forjar linha da tabela do `index.md`.
5. **Link**: `https` e host na allowlist da Shopee (mesma de `links.ts`) antes de escrever; resposta da API é dado, não instrução.
6. **Sem segredo na outbox**: App ID, Secret, header de assinatura e corpo bruto da API nunca são gravados. O `.md` leva só o que o grupo veria.
7. PNG limitado a `maxImageBytes` já existente; extensão e assinatura PNG conferidas.

**Adaptador WhatsApp (depois, não agora)**: implementa o mesmo `Channel`; o resto do pipeline não muda. Antes de ligar, condições de entrada: (a) Aurimar autoriza o primeiro envio real (regra já declarada); (b) antirrepetição e limite de ritmo existem de alguma forma, porque sem eles um erro repete mensagens num grupo real; (c) escolha do transporte registrada em decisão: automação não oficial de WhatsApp costuma violar termos e arrisca banir o número, e a API oficial pode não cobrir envio a grupo (confirmar na documentação antes de decidir).

## 2. O que acontece com o código atual

Princípio: **isolar, não apagar** (histórico fica no git e no repo). "Dormente" = continua no repo, com README de aviso, fora do caminho de execução e da CI padrão.

| Código | Destino | Detalhe |
|---|---|---|
| `packages/shopee`, `packages/creative`, `packages/domain` (estimativa, fuso, filtros, `unknown-result`) | **Mantém, é o núcleo** | `shopee` testado só contra o servidor simulado até o diagnóstico do 10010 (PR #42) |
| `apps/worker/src/{offer-selection,links,image}.ts` (seleção, host de link, downloader seguro de imagem) | **Mantém e reaproveita** | base do gerador novo |
| `apps/worker/src/executor.ts`, `ports.ts`, `runtime.ts`, `main.ts`, `heartbeat*`, `scheduler*` | **Dormente** | acoplados a `ClaimedSend`, lease, `finish_send`, Telegram |
| `apps/worker/src/sql/*`, `validation/*`, `commission-job.ts` | **Dormente** | Postgres, Vault, validação de token |
| `packages/telegram` | **Dormente** | sai das dependências de `apps/worker` e `apps/web` |
| `packages/alerts` (e-mail) | **Dormente** | substituído por resumo no terminal e código de saída |
| `packages/commission` | **Núcleo puro mantém; `sql/` dormente** | coleta adiada (§4) |
| `supabase/` (migrações, testes de banco) | **Dormente, intacto** | jobs de banco da CI viram `workflow_dispatch` ou saem do caminho padrão |
| `apps/web/src/server/supabase/*`, `realtime*`, `telegram-gateway.ts`, `/conexoes` | **Dormente** | o web já tem container em memória (`server/memory.ts`); passa a ser o único usado |
| Vault, RLS, Realtime | **Dormente** | credencial Shopee passa a vir de variável de ambiente |

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
| 10 | Mandar agora (e2e simulada) | **Gerar agora** (CLI → outbox) | E2E com Shopee simulada: N ofertas → N pares `.md`/`.png` + índice; reexecução do mesmo slot não duplica | pendente (T7-B); é o item central |
| 11 | Envios: cards, 30 dias, Realtime | `index.md` do dia | Índice lista as entregas do dia e resiste a título hostil | coberto por T7-A |
| 12 | Comissão a cada 6 h | **Adiado** | — | adiado |
| 13 | Alertas por e-mail | **Adiado**; resumo no terminal e exit code | Execução com falha sai ≠ 0 | coberto por T7-B |
| 14 | Onboarding e estados vazios | Web fora do caminho crítico; README de uso da CLI | README reproduzível do zero; QA visual só se o web continuar (§7) | reduzido |

## 6. Tarefas reescritas para Devs OpenCode

Cada tarefa: worktree e branch próprios, PR pequeno, `TASKS.md` → `em_revisao` com PR e evidência, **sem chamada real à Shopee** (só servidor simulado), segredos nunca em log/PR. Instruções explícitas para modelo menor: não mexer em arquivos fora da lista, não apagar nada dormente, rodar `pnpm typecheck && pnpm test` antes do PR.

**T7-A — `packages/channel` (interface + FileOutbox)**. Cria o pacote com os tipos do §1 e o adaptador. Arquivos: só `packages/channel/**` e uma linha em `pnpm-workspace`/`.gitignore` (`outbox/`). Aceite: testes para (1) título com `../`, `\n`, `---`, `|`, `[x](http://...)`, 10 000 caracteres e emoji; (2) `itemId` não numérico recusado; (3) link fora da allowlist recusado; (4) mesmo `slotKey` duas vezes → um arquivo só; (5) arquivo `0600`, pasta `0700`; (6) symlink na pasta do dia recusado; (7) `index.md` correto após 3 entregas, com título hostil.

**T7-B — gerador e CLI `pnpm outbox:gerar`**. Em `apps/worker/src/gerar/`: função pura com portas (`OfferSource`, `ShortLinker`, `ImageFetcher`, `RenderCreative`, `Channel`), reaproveitando `offer-selection.ts`, `links.ts`, `image.ts` e `@achadinhos/creative`. Dedupe só do lote; `--limite`; sem laço/retry; saída conforme §3. Aceite: e2e com o servidor Shopee simulado (N ofertas → N pares + índice; uma falha de imagem não derruba as outras; exit code); teste de que nenhum arquivo nem linha de log contém o Secret.

**T7-C — isolar o dormente**. Remove dependências de `packages/telegram`/`alerts` de `apps/worker` e `apps/web` (`package.json`), tira jobs de banco da CI padrão, adiciona `README.md` "DORMENTE: ver docs/plans/escopo-sem-supabase-telegram.md" em cada pasta do §2. **Não apaga arquivo nenhum.** Aceite: `pnpm install && pnpm typecheck && pnpm test` verdes sem Docker e sem Supabase CLI; `git diff --stat` sem deleções de código.

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
