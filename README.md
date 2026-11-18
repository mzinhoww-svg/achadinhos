# Achadinhos

Sistema pessoal de pesquisa: encontra ofertas reais na Shopee por nicho, trata a foto real do produto, escreve a
mensagem e publica em grupos de WhatsApp com link de afiliado. O time de agentes vive no OpenBot. Este repositório tem
o worker (as ferramentas dos agentes) e o painel.

| Parte | Onde | Documento |
| --- | --- | --- |
| Worker | https://achadinhos-worker.vertraweb.app | `docs/WORKER-API.md` |
| Painel | https://achadinhos-painel.vertraweb.app | `apps/painel` |
| Agentes | OpenBot no Mac do Aurimar | `openbot/README.md` |
| Pacote de instalação no OpenBot | `pacote/` | `pacote/LEIA-ME.md` |
| Deploy e variáveis | Vertra | `docs/DEPLOY.md` |
| Decisões | — | `docs/DECISOES.md` |

## Estrutura
```
apps/painel      Next.js (App Router), Tailwind, componentes shadcn/ui
apps/worker      Fastify + pg-boss; bíblia, propostas, eventos (LISTEN/NOTIFY)
packages/db      Drizzle, schema achadinhos, migrações
packages/shared  tipos e esquemas zod
packages/llm     cliente no padrão da API da OpenAI (OpenRouter), com modelo reserva
openbot/         guia do OpenBot e kit Docker de contingência
pacote/          pacote de instalação da operação no OpenBot
docs/            brief, decisões, deploy, API
```

## Desenvolvimento
```sh
pnpm install
pnpm lint && pnpm typecheck
DATABASE_URL_TESTE=postgres://usuario:senha@localhost:5432/achadinhos_teste pnpm test
pnpm empacotar     # pastas de deploy da Vertra em deploy/
```
