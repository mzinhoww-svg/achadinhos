# Decisões

Cada decisão com data, o que foi decidido e por quê. A mais nova fica no fim.

## D-001 · 18/11/2026 · Recomeçar o repositório do zero
O repositório tinha um monorepo anterior (apps/web, apps/worker, Supabase, Telegram). Questionado, o Aurimar escolheu
"começar do zero". O código antigo foi removido e continua no histórico do git (último estado: `main` em `4a06e99`).
O único conteúdo mantido foi o kit Docker do OpenBot, agora em `openbot/servidor-docker/`.

## D-002 · Monorepo pnpm + Turborepo, TypeScript estrito, Biome
- `apps/painel` (Next.js 16, App Router), `apps/worker` (Fastify 5 + pg-boss 12), `packages/db` (Drizzle),
  `packages/shared` (tipos e zod), `packages/llm`, mais as pastas `openbot/`, `pacote/` e `docs/`.
- Lint e formatação com Biome: uma dependência só, rápido, e cobre os dois. O CI roda lint, typecheck, testes (com
  Postgres 16 de serviço) e `pnpm empacotar`.
- Node 22 (a Vertra oferece 22.23.5). Versões das dependências fixadas, sem `^`.

## D-003 · Banco: schema `achadinhos` no Postgres `agencia-db`
- Todas as tabelas de `pacote/CONTRATO.md` ficam no schema `achadinhos`. Foram incluídas três a mais: `admins` (login do
  painel), `chamadas_pagas` (capacidade 7: custo e chave idempotente de toda chamada paga) e `__migracoes` (controle
  das migrações).
- A fila do pg-boss fica num schema separado, `achadinhos_fila`.
- As migrações (SQL gerado pelo drizzle-kit, em `packages/db/drizzle`) rodam no boot do worker. O banco é o mesmo da
  agência de vistos, então nada fora desses dois schemas é tocado.
- Recomendado: um usuário Postgres próprio, `achadinhos`, que só cria e usa os próprios schemas (SQL em
  `docs/DEPLOY.md`). Assim o worker não tem acesso aos dados da agência.
- O Postgres da Vertra exige TLS com CA própria e certificado de cliente (mTLS). O worker segue a mesma convenção da
  `agencia-worker`: `DB_SSL_CA_B64`, `DB_SSL_CERT_B64` e `DB_SSL_KEY_B64`. O modo padrão é `verify-ca`, que confere a
  CA mas não o nome do host, porque o certificado do servidor é emitido para "postgres". O `sslmode` da URL é
  removido, porque no `pg` ele sobrescreve a opção TLS do código.

## D-004 · Worker
- Rotas prontas: `/health`, `/biblia`, `/propostas`, `/eventos` e `/eventos/stream` (SSE via LISTEN/NOTIFY; o gatilho
  manda só o id do evento). As demais ferramentas do contrato respondem 501 com o motivo (capacidade 9). Detalhes em
  `docs/WORKER-API.md`.
- Toda rota, menos `/health` e `/`, exige o header `X-Service-Token`, comparado em tempo constante.
- A bíblia é versionada: cada gravação cria uma versão nova, e as antigas não mudam. Aprovar uma proposta com documento
  grava a nova versão na mesma transação. Gravações, propostas e decisões viram eventos e entram na auditoria.
- O worker sobe mesmo sem variáveis ou com o banco fora do ar. Ele diz o que falta em `/health` e tenta o banco de
  novo, em vez de entrar em crash loop (a Vertra suspende a app depois de 5 crashes em 10 minutos).
- `/health` responde sempre HTTP 200, com `ok` e `erro` no corpo, porque a borda da Vertra troca respostas 5xx pela
  página de erro dela e o motivo se perderia.
- O deploy é um único `worker.mjs` (esbuild) mais as migrações. Não há `node_modules` nem instalação na Vertra.

## D-005 · Painel
- O painel não acessa o banco: tudo passa pelo worker, com o `SERVICE_TOKEN` só no servidor do Next.
- Login: o worker confere a senha (scrypt, limite de 5 tentativas a cada 15 min por e-mail). O painel guarda a sessão
  num cookie assinado com HMAC-SHA256 (`AUTH_SECRET`), HttpOnly, com 12 h de validade.
- O primeiro admin é criado no boot do worker, se não houver nenhum, a partir de `ADMIN_EMAIL` e
  `ADMIN_SENHA_INICIAL`. Depois do primeiro login, apague `ADMIN_SENHA_INICIAL`.
- Tailwind 4 com componentes no padrão shadcn/ui (`components.json` pronto para `npx shadcn add`). O markdown da
  bíblia é renderizado com `markdown-it` com HTML desligado: é seguro e mais leve que o react-markdown.

## D-006 · Deploy na Vertra (runtime Node nativo, sem imagem própria)
- Apps: `achadinhos-worker` (512 MB, `https://achadinhos-worker.vertraweb.app`) e `achadinhos-painel` (768 MB,
  `https://achadinhos-painel.vertraweb.app`). Os nomes levam o prefixo para não confundir com `agencia-worker`.
- O painel precisou de 768 MB: com 512 MB, o `npm install` da Vertra estourava a memória (`INSTALL_OUT_OF_MEMORY`).
  As dependências foram reduzidas de 162 para 73 pacotes, e o pacote leva `package-lock.json`. O plano pro-4 ficou com
  3840 de 4096 MB em uso.
- A Vertra não entende monorepo pnpm, então `pnpm empacotar` monta pastas autônomas em `deploy/`, que são enviadas
  por upload. O painel leva `@achadinhos/shared` em `libs/shared`, porque a Vertra remove pastas chamadas `vendor` do
  zip.
- A Vertra não aceita variável vazia. As variáveis secretas foram criadas com o valor `PENDENTE`, e o código trata
  esse marcador como ausente. Assim, o painel da Vertra mostra o que falta colar.
- Sem deploy automático pelo GitHub por enquanto. Quando houver, ele deve rodar `pnpm empacotar` num job e enviar as
  pastas.

## D-007 · OpenBot no computador do Aurimar (a Vertra recusa o container)
- A Vertra recusa user namespaces e não oferece seccomp próprio, então o container oficial não sobe. A evidência está em
  `openbot/servidor-docker/CONTINGENCIA.md`. O OpenBot roda no aplicativo do Mac do Aurimar, que precisa ficar ligado
  nos horários de envio.
- Esta sessão (na nuvem) não consegue usar o Mac. A pasta "OpenBot" aparece na lista do Remote Control, mas não é
  oferecida a sessões na nuvem. A instalação e a abertura do OpenBot ficam com o Aurimar (passo a passo em
  `openbot/README.md`).
- A licença do OpenBot é PolyForm Noncommercial 1.0.0. Se o projeto passar a gerar comissão de forma recorrente,
  revise a licença.

## D-008 · Como o OpenBot funciona (estudado no README e em `docs/` do nightly-labs/openbot, versão 0.73.0)
- **Agentes:** são criados conversando com um agente (`openbot.create_agent`: nome, instruções, primeira tarefa e,
  opcionalmente, provedor, modelo e esforço) e editados com `openbot.update_profile`. Cada um tem workspace próprio,
  fila de mensagens, memória e conversa com os outros agentes.
- **Ferramentas:** há quatro caminhos.
  1. Servidores **MCP**, cadastrados no app por computador, com acesso definido por agente.
  2. O **terminal** do agente no workspace (HTTP com `curl`).
  3. **Skills/plugins** em pastas como `.agents/skills`.
  4. **ACP**, para agentes próprios.
  Por ora, os agentes chamam o worker por HTTP com o header `X-Service-Token`. Próximo passo sugerido: o worker expor
  `/mcp`, para as ferramentas aparecerem nativas.
- **Credenciais:** ficam no cofre do OpenBot (chaves que o agente pede com `request_api_key`). O `SERVICE_TOKEN` vai lá,
  nunca na bíblia nem no chat.
- **OpenRouter:** isto corrige o pacote. Na versão atual, o OpenRouter **é provedor nativo**, só com chave (pelo
  runtime Pi): Settings › Providers › OpenRouter › colar a chave. Os modelos usam o formato `lab/modelo` (ex.:
  `anthropic/claude-sonnet-5.5`). Se a opção não aparecer na versão instalada, use "Custom OpenAI-compatible endpoint"
  com `https://openrouter.ai/api/v1`. O OpenCode também é nativo.
- **Rotinas por webhook:** no editor da rotina, em "When to run", escolha Webhook. O OpenBot gera a URL e o segredo
  (`whsec_…`, padrão Standard Webhooks, mostrado uma vez).
  - O envio é um `POST` JSON `{type, occurredAt, data}` com os headers `X-OpenBot-Timestamp`, `X-OpenBot-Delivery-Id`
    e `X-OpenBot-Signature` (`sha256=` + HMAC-SHA256 de `timestamp.deliveryId.corpo`).
  - Cabem até 64 rotinas por host. O OpenBot precisa estar aberto e logado na conta.
  - No mesmo computador também existe a "Local scripts API" (127.0.0.1), por agente.

## D-009 · Segurança
- Nenhum segredo no git: `.env*` estão no `.gitignore`, e `.env.example` só tem os nomes.
- Ao consultar o banco pelo conector da Vertra (`get_connection_info`), a resposta trouxe também a chave privada do
  certificado de cliente do Postgres. Ela não foi gravada em nenhum arquivo. Esse certificado é o mesmo das apps da
  agência; rotacioná-lo (`reset_certificate`) exigiria atualizar as variáveis delas. **Decisão do Aurimar.**
- A chave da API da Vertra usada no deploy está como segredo de rede do ambiente cloud `achadinhos`, nunca em arquivo.
