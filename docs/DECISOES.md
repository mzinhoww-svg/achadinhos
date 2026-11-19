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

## D-010 · 18/11/2026 · Painel: entrevista (Parte 1C) e esqueleto navegável

- Respostas do Aurimar e mapa de telas em `docs/PAINEL.md`, aprovado.
  - Visão geral com PAUSAR, ofertas, cliques e conversões, alertas e custos.
  - Ofertas só para consulta. Checagens com proposta de ajuste de regra.
  - Nichos e grupos com edição direta. Chips com troca do ativo, QR e histórico de quedas.
  - Números com 7 dias por padrão e recortes por nicho, grupo, horário e oferta. Log em tempo real.
  - Visual limpo e neutro, com menu lateral no celular.
- As 11 telas estão publicadas. As que dependem de ferramentas ainda não construídas usam dados falsos de
  `apps/painel/src/lib/demo.ts` e mostram a faixa "Demonstração".
- Já são reais: a Bíblia (documentos e a nova aba Propostas, com aprovar e recusar) e o Log dos agentes. O Log usa o
  fluxo `/eventos/stream` do worker, repassado pelo painel em `/api/eventos/stream`, para o token não ir ao navegador.
- O menu do celular abre num portal no `body`: o `backdrop-blur` do cabeçalho prendia a gaveta `fixed` dentro dele.

## D-011 · 18/11/2026 · Coleta (Garimpeiro) e preços (Monitor), Prompt 2

- **Adaptadores** (`packages/marketplace`): uma interface `MarketplaceAdapter` com `buscar`, `detalhe` e
  `gerarLinkAfiliado`. Implementações:
  - `shopee`: Open API de Afiliados, GraphQL;
  - `mercadolivre`: stub que responde 501 (fase 2);
  - `fake`: dados fixos, com `definirPreco` para simular quedas.
- **Shopee, documento GraphQL:** argumentos inline e corpo só com `query`, sem `variables`. O projeto anterior usava
  variáveis tipadas (`$itemId: Int`) e recebia `10010` (parse) da API real; o `itemId` da Shopee passa de 32 bits.
  Strings vão escapadas com `JSON.stringify`. Isso ainda precisa ser confirmado na API real, com as chaves do Aurimar.
- **Shopee, segurança:**
  - assinatura `SHA256 Credential=<appId>, Timestamp=<s>, Signature=sha256(appId+ts+corpo+secret)`;
  - endpoint conferido antes de assinar (só `*.shopee.com.br`, ou loopback para o servidor simulado);
  - `redirect: "manual"`;
  - timeout e teto de 2 MB na resposta;
  - o Secret nunca aparece em log nem em JSON.
- **Erros da Shopee:**
  - recuperáveis: `10030` (limite de taxa), `10000` (sistema), 429 e 5xx;
  - definitivos: `10020` (assinatura), `10010` (consulta), `10035` (sem acesso à Open API).
- **Limite e retry (T2.5):** balde de fichas por adaptador; padrão de 30 chamadas por minuto (`SHOPEE_POR_MINUTO`).
  O limite real da Shopee não está publicado; 30/min dá 1800/h, abaixo dos 2000/h que circulam como referência.
  - São até 3 tentativas, com espera crescente e jitter; limite de taxa espera 5 vezes mais.
  - Toda falha vira o evento `marketplace.erro`.
- **Link de afiliado:**
  - a coleta guarda o `offerLink` que a Shopee já devolve na busca, sem chamada extra;
  - o link curto com subIds (grupo, nicho, oferta, horário: capacidade 13) vem de `generateShortLink` na hora do
    envio, porque depende do grupo;
  - a Shopee aceita até 5 subIds, só alfanuméricos.
- **Monitor (T2.3):** job no pg-boss, fila `monitor-precos` (`singleton`), cron `0 */2 * * *` no fuso de São Paulo.
  Para gastar menos chamadas, ele:
  1. refaz as buscas dos nichos (uma chamada atualiza até 50 produtos);
  2. consulta um a um, até 100 por rodada, só os que a busca não trouxe;
  3. para de acompanhar o produto que sumiu do marketplace.

  Repetir o mesmo preço em menos de 60 minutos não gera nova linha no histórico.
- **Oferta real (T2.4):** preço atual pelo menos X% abaixo da mediana dos últimos 30 dias.
  - X é do nicho, padrão 15.
  - A observação atual fica fora da mediana, para a própria queda não puxar a referência.
  - Avaliação mínima é 4,5 e vendas mínimas são 50, por nicho.
  - "Histórico suficiente" significa 4 observações anteriores e a mais antiga com 3 dias ou mais
    (`HISTORICO_MIN_AMOSTRAS` e `HISTORICO_MIN_DIAS`). Logo, um produto novo leva cerca de 3 dias para poder virar
    oferta.
  - No máximo uma oferta aberta por produto, garantida por índice único parcial no banco.
- **Pontuação (T2.7), de 0 a 100:**

  | Componente          | Peso | Cheio quando |
  | ------------------- | ---- | ------------ |
  | Desconto real       | 45   | 50%          |
  | Comissão            | 25   | 15%          |
  | Vendas (escala log) | 15   | 10 mil       |
  | Nota                | 15   | de 4,0 a 5,0 |

  `GET /ofertas` ordena pela pontuação.
- **Nichos:** a rota `POST /nichos` não está no contrato original; foi criada porque a coleta precisa de nichos
  cadastrados (o Coordenador cadastra a partir de NICHOS.md). As rotas novas estão documentadas em
  `docs/WORKER-API.md`.

## D-012 · 18/11/2026 · Produção no ar e aceite real do Prompt 2

- **Banco:** a conexão exigiu três coisas.
  1. A CA da Vertra, agora embutida como padrão no worker. É pública; foi conferida com `openssl verify`.
  2. O certificado de cliente (mTLS), gravado nas variáveis do worker direto do arquivo, sem passar pelo chat.
  3. O usuário `achadinhos`, criado pelo Aurimar no console SQL. A senha com `@` e `!` precisa ir codificada na URL.
- **Login do painel funcionando** em produção. A troca de senha fica em "Minha conta", com mínimo de 12 caracteres;
  a senha inicial aceita 8.
- **Busca real na Shopee** (nicho "Casa e cozinha até R$ 50", 8 palavras): 159 produtos únicos, todos com link de
  afiliado (`s.shopee.com.br`), em cerca de 50 s. **O erro `10010` do projeto antigo não voltou**, o que confirma que a
  causa eram as variáveis tipadas no documento GraphQL.
- **Limites reais observados:**
  - a Shopee devolve `10000` (erro do sistema) de vez em quando; o retry resolveu em quase todos os casos;
  - no Monitor, 1 de 8 buscas falhou depois das tentativas e foi para os eventos;
  - nenhum `10030` (limite de taxa) apareceu com 30 chamadas por minuto.
- **Monitor real:** 7 buscas atualizaram 140 produtos e 19 foram consultados um a um, em cerca de 45 s. As primeiras
  ofertas reais só aparecem depois de 3 dias de histórico.
- **Nicho piloto:** cadastrado com as regras da bíblia do Coordenador (desconto de 20%, nota 4,5 e 100 vendas). As
  palavras-chave são provisórias; o Coordenador troca pelas do NICHOS.md com `POST /nichos` e o mesmo nome.

## D-013 · 18/11/2026 · Arte (Prompt 3)

- **Recorte sem IA, dentro do worker.** Os modelos de remoção de fundo em Node (ONNX) pedem cerca de 1 GB de memória;
  o worker tem 256 MB livres. O recorte usa o sharp: estima a cor do fundo pela borda da foto, inunda a partir das
  bordas e mede a confiança pela uniformidade da borda e pela área que sobra para o produto. Fotos de produto da
  Shopee têm fundo liso na maioria; as outras caem no fallback, que é o comportamento pedido.
- **Regra inviolável garantida no código:** o recorte só muda a transparência do fundo e a ampliação é Lanczos. Os
  testes conferem que o pixel do produto é idêntico ao da foto original.
- **Mesma área em todas as peças:** o produto ocupa 50% da área reservada (limitado pela largura e altura), com
  sombra elíptica leve.
- **Satori + resvg** com a fonte Inter (licença OFL, em `packages/arte/fontes`). Saída em JPEG de qualidade 90.
- **Preço riscado:** na oferta, o "de" é a mediana real de 30 dias; nunca o preço cheio inventado pela loja. Na
  prévia de produto (antes de existirem ofertas reais), o "de" é o anunciado pela loja e a peça fica marcada como
  `previa`.
- **Armazenamento:** o Blob da Vertra precisa de uma chave com permissão `blob:write`, que só o Aurimar cria no
  painel. Até lá, as peças ficam no banco e saem por `GET /arquivos/...`, público e com caminho aleatório. Quando a
  chave entrar em `VERTRA_BLOB_KEY`, as novas peças vão para o Blob sem mudar o código.
- **Deploy:** sharp, satori e resvg têm binários nativos, então ficam fora do bundle e a Vertra instala com npm.
- **Uma renderização por vez** no worker, para não estourar a memória.

## D-014 · 18/11/2026 · Erros `ERRO_SISTEMA` da Shopee

- **Sintoma:** na rodada do Monitor das 16h, 4 buscas falharam com `10000` mesmo depois de 3 tentativas com cerca de
  1,5 s de espera.
- **Mudanças:**
  - palavras-chave com acento vão escapadas (`á`) no GraphQL, e o corpo assinado fica só com ASCII. A
    suspeita é de que essas buscas falham sempre, e não por acaso;
  - `ERRO_SISTEMA` tem 4 tentativas com espera de 3 s, 6 s e 12 s;
  - cada `marketplace.erro` traz o `alvo` (palavra ou id) para confirmar se as falhas se repetem nas mesmas palavras.
- **Próximo passo:** conferir os eventos da próxima rodada. Se as falhas continuarem nas mesmas palavras sem acento,
  a próxima medida é baixar `SHOPEE_POR_MINUTO`.

## D-015 · 18/11/2026 · wa-gateway com vários números (Prompt 4)

- **O repositório `wa-gateway` estava vazio.** O código que roda na Vertra foi baixado da própria app e entrou como
  primeiro commit ("estado atual em produção"); o Prompt 4 vem em cima, no branch do Claude.
- **Tudo aditivo:** as rotas `/v1/instances`, `/v1/optin`, `/v1/messages` e a fila original continuam iguais para o
  Revela. Os 64 testes antigos seguem passando (81 no total).
- **Pools:** um ativo e reservas por projeto, heartbeat de 60 s, failover para o próximo reserva conectado **e admin
  dos grupos**, webhook `pool.*` para o projeto. Fila própria por grupo (1 a cada 180 s + 20 a 90 s aleatórios) e
  aquecimento por número (15, 30, 60 e 150 mensagens por dia).
- **Número pessoal nunca conecta:** os telefones do dono ficam em `adminPhones`; se um deles for pareado, o gateway
  desconecta e bloqueia. Só eles recebem alertas e mandam comandos.
- **Chave por projeto (`EXTRA_API_KEYS`) e token no webhook:** gerados aqui e gravados direto nas variáveis da Vertra,
  sem passar pelo chat. O Achadinhos não usa a `API_KEY` do Revela.
- **Pendente do Aurimar:** parear os 3 chips (link de QR no painel), informar o telefone pessoal (`POST /wa/pool`),
  criar o grupo de teste e o real com os chips como admins.

## D-016 · 18/11/2026 · Copy, checagem, disparo e travas (Prompt 5)

- **Regras na bíblia:** `REGRAS-DE-ENVIO`, `CHECAGEM`, `TOM-DE-VOZ` e `AGENTES` aceitam um bloco ```json; o que faltar
  usa o padrão da bíblia v1.0 do Coordenador.
- **Copy:** o LLM gera 2 variações, e um validador determinístico confere cada preço, porcentagem e o nome contra o banco,
  além de `#publi` e `{{link}}`. Se nenhuma passar, ou sem chave, ou acima do teto de gasto, entra o **modelo fixo**,
  que sempre passa: o ciclo não para por causa do LLM.
- **Fallback da arte na checagem:** a peça no fallback usa a foto real, então só é reprovada abaixo de 0,2 de confiança
  (`fallbackConfiancaMin` em CHECAGEM). Reprovar todo fallback descartaria cerca de 60% das fotos da Shopee.
- **Preço revalidado no minuto do envio** (Shopee `productOfferV2` por item). Subiu ou acabou: cancela e avisa.
- **Banimento pausa tudo** (regra da bíblia), mesmo com o failover do gateway; `pausarEmBanimento` desliga isso.
- **Ciclo reserva já no Prompt 5:** sem sinal dos agentes por 30 min, o worker prepara e agenda sozinho. Isso também
  permite o ensaio antes de o OpenBot estar ligado.
- **Oferta de ensaio:** produto `fake` com foto e link de um produto real, desconto forçado, só para grupos de teste.

## D-017 · 18/11/2026 · Agentes ligados ao worker por MCP (Prompt 7)

- **O worker virou servidor MCP** (`POST /mcp`, Streamable HTTP com respostas JSON). As ferramentas aparecem nativas no
  OpenBot, com descrição e schema em português.
- **Permissão mínima de verdade:** cada agente tem um token próprio (`ach_…`, HMAC do `SERVICE_TOKEN` com o nome do
  agente). O token define quem é o agente: ele só vê e só chama as ferramentas da sua função, e os campos de autoria
  (autor, decididoPor, agente) são preenchidos pelo worker com o nome do token, não pelo que o agente escreve.
- **Sem segredo no chat:** a tela **Agentes** do painel mostra a configuração de cada agente para copiar no OpenBot.
- **Equipe versionada:** `openbot/equipe.json` (agentes, modelos com reserva, ferramentas e rotinas da ROTINA.md) e
  `openbot/agentes/*.md`. Um teste garante que `equipe.json` bate com as ferramentas que o worker libera.
- **Modelos:** Coordenador e Copywriter num modelo melhor; Garimpeiro, Monitor, Arte e Disparador num barato, todos
  com reserva. Os nomes são sugestões: o Aurimar confirma no catálogo do OpenRouter na hora de criar.
- **Custo por agente:** as chamadas de LLM do próprio worker já são gravadas. As do OpenBot acontecem dentro dele; os
  agentes registram com `registrar_custo`, e o total entra no teto diário. Não há como o worker medir sozinho o gasto
  que acontece no OpenBot.
- **Resumo do dia:** o Coordenador fecha às 21h com `enviar_resumo_whatsapp`; se não fizer, o worker manda às 21h05.
  Propostas aprovadas que mexem em gasto ou grupos aparecem em destaque.
- **Ciclo reserva:** qualquer chamada pelo MCP conta como sinal de vida; 30 min de silêncio ligam o ciclo do worker.
- **Pendente do Aurimar (no Mac):** cadastrar os 6 servidores MCP, criar os agentes e as rotinas (`openbot/RECRIAR.md`).
  "Um dia inteiro só pelos agentes" só pode ser conferido depois disso.

## D-018 · 18/11/2026 · Conversões, qualidade e operação (Prompt 8)

- **Conversões da Shopee:** `conversionReport` da Open API, paginado por `scrollId`, todo dia às 05:40 com os últimos 7
  dias (o status dos pedidos muda depois da compra). Os subIds voltam em `utmContent`; o código do link liga o pedido
  ao link e, por ele, à oferta, ao grupo e ao horário. Os nomes dos campos seguem a documentação da Open API; como
  ainda não houve venda real, a primeira importação de verdade precisa ser conferida no painel (Conversões).
- **Custo por agente e por oferta enviada** em Números. As chamadas do worker entram sozinhas; as do OpenBot entram
  pela ferramenta `registrar_custo`.
- **Teste de ponta a ponta** (`apps/worker/src/e2e.test.ts`): coleta → Monitor → candidata → ciclo reserva → envio →
  confirmação → clique → conversão → métricas, com adaptador e gateway falsos.
- **Segredos:** gitleaks no CI a cada push, no histórico inteiro. A varredura local encontrou só fixtures de teste do
  projeto antigo (valores falsos), liberados por commit em `.gitleaks.toml`.
- **/r com limite** de 30 acessos por minuto por IP (429 depois).
- **Snapshot diário:** a Vertra já faz snapshot automático do `agencia-db` toda noite (~00:35 de Brasília), confirmado
  na lista de snapshots desde 14/11. Nenhum código extra foi preciso.
- **Alertas no WhatsApp** também quando os jobs de disparo, ciclo reserva ou conversões falham (uma vez por dia por tipo).
