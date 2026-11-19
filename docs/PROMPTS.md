# Achadinhos · Prompts do piloto (Shopee)

São 8 prompts em sequência, cada um num chat novo do Claude Code. Um prompt só começa quando o anterior passar no aceite. Copie só o texto de dentro de cada bloco.

| #   | Prompt                               | Onde colar                                        | Avança quando                                                       |
| --- | ------------------------------------ | ------------------------------------------------- | ------------------------------------------------------------------- |
| 1   | Instalador                           | Claude Code, repo `achadinhos`, com o zip anexado | Painel e worker no ar, pacote gravado, esqueleto do painel aprovado |
| —   | Mensagem curta do passo 10           | OpenBot, em paralelo à entrevista do painel       | Equipe criada e os 11 documentos na tela Bíblia                     |
| 2   | Coleta e Monitor                     | repo `achadinhos`                                 | Busca real do nicho grava produtos e histórico de preços            |
| 3   | Arte                                 | repo `achadinhos`                                 | 10 produtos renderizados, fallback testado                          |
| 4   | wa-gateway com vários números        | repo `wa-gateway`                                 | 3 sessões pareadas, failover simulado                               |
| 5   | Copy, checagem, disparo e link curto | repo `achadinhos`                                 | Uma oferta chega sozinha ao grupo de teste; o clique é contado      |
| 6   | Painel com dados reais               | repo `achadinhos`                                 | Todas as telas de `docs/PAINEL.md` funcionando                      |
| 7   | Agentes ligados às ferramentas       | repo `achadinhos`, pasta `openbot`                | Um dia inteiro roda sem nenhuma ação sua                            |
| 8   | Conversões, qualidade e go-live      | repo `achadinhos`                                 | Lista "Pronto quando" toda marcada                                  |

---

## Prompt 1 · Instalador

```text
# Instalação do Achadinhos: Vertra, OpenBot e painel

Você vai instalar o Achadinhos, um sistema pessoal de pesquisa que encontra ofertas reais na Shopee por nicho (Mercado Livre na fase 2), trata a foto real do produto, escreve a mensagem e publica em grupos de WhatsApp com link de afiliado. Quem pediu é o Aurimar. Fale em português, com frases curtas. Antes de cada etapa, diga o que vai fazer; antes de criar algo pago ou irreversível na Vertra, peça confirmação.

## Por que o OpenBot
A operação é um time de seis agentes (Coordenador, Garimpeiro, Monitor, Arte, Copywriter e Disparador) que vive no OpenBot (https://openbot.run). É lá que os agentes são criados, conversam entre si, guardam o contexto, rodam as rotinas e passam pelas checagens automáticas. Não recrie os agentes no Claude Code nem em outra ferramenta: você prepara a casa e o OpenBot monta o time. O trabalho repetitivo (APIs, imagem, envio, métricas) fica no worker, que os agentes chamam pelas ferramentas descritas em pacote/CONTRATO.md.

## Onde você está
- No OpenBot (você tem ferramentas como create_agent): vá direto para a Parte 2.
- No Claude Code, no Codex ou em outro agente com terminal e acesso ao repositório: faça a Parte 1 e a Parte 1C.
- Sem terminal (chat no navegador): explique que a instalação precisa de um agente com terminal e pare.

## Parte 1: preparar a casa
Repositório: mzinhoww-svg/achadinhos. Autonomia total, exceto onde este texto pede confirmação. Registre cada decisão em docs/DECISOES.md.

1. Plano: confira o acesso ao GitHub, à Vertra (MCP ou CLI) e ao Postgres, e mostre um plano curto do que vai criar.
2. Monorepo pnpm + Turborepo, TypeScript estrito: apps/painel (Next.js App Router), apps/worker (Fastify + pg-boss), packages/db (Drizzle), packages/shared (tipos e zod), packages/llm (padrão da API da OpenAI, OpenRouter por padrão, modelo de cada tarefa definido na bíblia e um modelo reserva), openbot/, pacote/ e docs/. CI com typecheck, lint e test.
3. Banco: schema achadinhos no Postgres existente, com as tabelas listadas em pacote/CONTRATO.md.
4. Worker mínimo: /health, token entre serviços (header X-Service-Token), /biblia, /propostas e /eventos (LISTEN/NOTIFY). As outras ferramentas do contrato respondem 501 com o motivo pendente, até serem construídas.
5. Painel mínimo: login do admin (criado no seed) e a tela Bíblia, que lista e mostra os documentos.
6. OpenBot: use o aplicativo no computador do Aurimar, como no estúdio do Buzzi (a Vertra não aceita o container dele). Confira se está instalado e aberto; se não estiver, baixe em https://openbot.run/download e instale. Leia o README em github.com/nightly-labs/openbot e registre em DECISOES.md como os agentes são definidos, como chamam ferramentas (HTTP, MCP, plugin ou ACP), como conectar o OpenRouter como endpoint compatível com OpenAI (ele não é provedor nativo; o OpenCode é) e como disparar rotinas por webhook.
7. Deploy na Vertra de painel e worker (runtime Node nativo, sem imagem própria) antes de qualquer configuração. Variáveis em .env.example. Nenhum segredo no git nem no chat: peça para o Aurimar colar as chaves direto nas variáveis da Vertra e nas credenciais do OpenBot.
8. Pacote: descompacte o achadinhos-pacote.zip anexado e grave em pacote/ os arquivos LEIA-ME.md, COMECE-AQUI.md, PROMPT_INSTALACAO.md e CONTRATO.md sem mudar o texto, só trocando {{WORKER_URL}} pela URL real. Crie docs/BRIEF.md com o contexto deste prompt.
9. Validação: as URLs do painel e do worker respondem, o OpenBot abre, um agente de teste responde e o worker grava e lê um documento da bíblia. Typecheck não prova deploy: abra cada URL.
10. Mensagem para o OpenBot: copie o texto abaixo para a área de transferência (ou mostre para o Aurimar copiar) e oriente, um passo de cada vez: abrir o OpenBot, conectar o provedor (OpenRouter), abrir a conversa com um agente, colar e enviar.

    Quero instalar a operação Achadinhos. Leia pacote/LEIA-ME.md e siga pacote/PROMPT_INSTALACAO.md do começo ao fim, falando comigo em português. Worker: {{WORKER_URL}}.

    Se o OpenBot não tiver acesso à pasta do repositório, junte à mensagem o conteúdo dos arquivos do pacote.

## Parte 1C: entrevista do painel (em paralelo à Parte 2)
Enquanto o Aurimar responde ao OpenBot, faça as perguntas do painel em blocos de até 5, com opções sugeridas: o que cada tela mostra (Visão geral, Nichos, Checagens, Ofertas, Grupos, Números, Links e cliques, Conversões, Bíblia, Log dos agentes), o que ele faz todo dia no computador e no celular, e referências visuais. Regra de design: o mais fácil de usar. Mobile first, uma ação principal por tela, tabelas com filtro, nenhum gráfico sem uma decisão por trás. Use shadcn/ui + Tailwind.
- Escreva docs/PAINEL.md com mapa de telas, componentes e estados (vazio, carregando, erro) e peça aprovação.
- Publique na Vertra o design system e o esqueleto navegável de todas as telas, com dados falsos.

## Parte 2: instalar a operação no OpenBot
1. Leia pacote/LEIA-ME.md e siga pacote/PROMPT_INSTALACAO.md do começo ao fim. Daqui em diante, o instalador do pacote conduz as perguntas.

## Final
Termine com um resumo: URLs de cada serviço, o que foi instalado, onde está o pacote, o que o Aurimar faz agora no OpenBot e o que ficou pendente. Atualize docs/DECISOES.md.

## Regras
- Nunca peça chaves, senhas ou tokens no chat. As credenciais ficam nas variáveis da Vertra e nas credenciais do OpenBot.
- Não publique nada nos grupos e não crie contas em nome do Aurimar.
- Se algo falhar, explique em uma frase o que aconteceu e o que ele pode fazer.
```

---

## Prompt 2 · Coleta e Monitor

```text
# Prompt 2 · Coleta (Garimpeiro) e preços (Monitor)

Leia pacote/CONTRATO.md, docs/BRIEF.md e docs/DECISOES.md antes de começar. Repositório: achadinhos. Autonomia total nesta fase.

## Tarefas
T2.1 Interface MarketplaceAdapter { buscar(palavra, filtros), detalhe(id), gerarLinkAfiliado(url) } com três implementações: shopee (Open API de afiliados do Brasil, GraphQL em open-api.affiliate.shopee.com.br/graphql, assinada com App ID e Secret; busca por productOfferV2 e link por generateShortLink com subIds); mercadolivre (fase 2: deixe só a interface e um stub que responde 501; não implemente no piloto); fake (dados fixos para testes).
T2.2 POST /coleta/buscar: recebe o nicho, roda as palavras-chave nos adaptadores, normaliza e grava produtos (dedupe por marketplace + id).
T2.3 Job do Monitor: a cada 2 horas atualiza preço e estoque dos produtos acompanhados e grava historico_precos.
T2.4 Oferta real: preço atual pelo menos X% abaixo da mediana dos últimos 30 dias (X por nicho, padrão 15), com avaliação e vendas mínimas configuráveis. Sem histórico suficiente, não vira oferta. Ao detectar, cria a oferta como candidata e grava o evento oferta_detectada.
T2.5 Rate limit e retry com backoff por adaptador; erros vão para eventos.
T2.6 Testes com o adaptador fake: dedupe, regra de desconto e produto sem histórico.
T2.7 Pontuação da oferta: desconto real, comissão, vendas e nota, que já vêm no productOfferV2. As de maior pontuação saem primeiro.

## Aceite
- Busca real do nicho piloto grava ao menos 30 produtos com link de afiliado.
- O Monitor roda sozinho e o histórico cresce.
- Um preço forçado para baixo no fake gera uma oferta candidata.

## Relatório final
Produtos gravados, limites da API encontrados e decisões novas.
```

---

## Prompt 3 · Arte

```text
# Prompt 3 · Arte (tratamento da foto do produto)

Leia pacote/CONTRATO.md, docs/BRIEF.md e docs/DECISOES.md. Repositório: achadinhos.

Regra inegociável: a peça final usa a foto real do produto. Nenhuma IA altera o produto (cor, forma, detalhes, acessórios). IA só mexe no entorno.

## Tarefas
T3.1 POST /imagem/render { ofertaId, formato: quadrado | retrato }: baixa a foto oficial de melhor resolução.
T3.2 Remoção de fundo com uma biblioteca em Node dentro do próprio worker (a Vertra roda um container por app, sem sidecar Python). Grave a máscara e uma nota de confiança.
T3.3 Padronização com sharp: produto centralizado, ocupando a mesma área em todas as peças, com sombra leve.
T3.4 Templates por nicho guardados na bíblia (cores, fontes, logo, posição do selo), renderizados com Satori + resvg: fundo, selo de % OFF, preço antigo riscado, preço novo e marca do grupo. Saída 1080x1080 e 1080x1350.
T3.5 Upscale só quando o menor lado da foto tiver menos de 800 px.
T3.6 Fallback: recorte ruim ou confiança baixa usa a foto original dentro de uma moldura do template e marca a peça.
T3.7 Peças salvas no storage da Vertra, com URL pública.

## Aceite
- 10 ofertas do nicho piloto renderizadas nos dois formatos, lado a lado com a original numa página de conferência no painel.
- Um caso forçado de recorte ruim cai no fallback.
```

---

## Prompt 4 · wa-gateway com vários números

```text
# Prompt 4 · wa-gateway com vários números e failover

Repositório: mzinhoww-svg/wa-gateway (Baileys, já no ar na Vertra com um chip). Não quebre o que já funciona para outros projetos.

## Tarefas
T4.1 Várias sessões Baileys no mesmo serviço, uma por número, com credenciais persistidas no Postgres (schema do gateway).
T4.2 Pareamento por QR numa rota protegida, para eu parear os 3 chips.
T4.3 API: POST /grupos/:jid/mensagem { imagem, texto } pelo número ativo do pool; POST /privado para alertas e resumo diário; GET /numeros com status e último heartbeat.
T4.4 Heartbeat a cada 60 s por sessão. Logout, ban ou falha repetida: marca o número como banido, promove o próximo reserva que já seja admin do grupo e chama um webhook (o worker do Achadinhos escuta).
T4.5 Fila de envio com limite por grupo (padrão: no máximo 1 mensagem a cada 3 minutos por grupo, espaçamento aleatório de 20 a 90 s), configurável por API.
T4.6 Webhook das mensagens recebidas no privado, para eu mandar PAUSAR ou RETOMAR.
T4.7 Testes do failover com uma sessão simulada.
T4.8 Entrada por wa.me: um link wa.me com mensagem pronta (ex.: Quero entrar no grupo de ofertas de casa). O bot responde no privado com o convite do grupo certo e registra a origem do membro.
T4.9 Proteção dos números: aquecimento gradual de cada chip, intervalos aleatórios e Baileys sempre atualizado. Meu número pessoal é o dono do grupo e nunca conecta no gateway.

## Aceite
- 3 números pareados; GET /numeros mostra 1 ativo e 2 reservas.
- Derrubar a sessão ativa promove a reserva em até 2 minutos, e o envio seguinte sai pelo número novo.
- Mandar a mensagem do link wa.me devolve o convite do grupo.
- As integrações antigas do gateway continuam funcionando.
```

---

## Prompt 5 · Copy, checagem automática, disparo e link curto

```text
# Prompt 5 · Copy, checagem automática, disparo e link curto

Leia pacote/CONTRATO.md, docs/BRIEF.md, docs/DECISOES.md e os documentos da bíblia (GET /biblia), em especial TOM-DE-VOZ.md, CHECAGEM.md e REGRAS-DE-ENVIO.md. Repositório: achadinhos.

## Tarefas
T5.1 Copywriter: POST /ofertas/:id/copy via packages/llm, com o modelo definido na bíblia. Usa o tom e os exemplos aprovados e gera 2 variações. Só usa dados do produto: um validador confere se preço, desconto e nome no texto batem com o banco, e reprova se não baterem ou se faltar a identificação de publicidade.
T5.2 Link curto no painel: /r/:codigo registra o clique (hash do IP, user agent, oferta, grupo, horário) e redireciona (302) para o link de afiliado. Um código por oferta e grupo; na Shopee, o mesmo código vai nos subIds do generateShortLink.
T5.3 Checagem automática: POST /ofertas/:id/checar reprova sozinha a oferta com preço diferente do banco, imagem no fallback com baixa confiança, produto repetido no prazo de CHECAGEM.md, marca ou nicho bloqueado, ou copy reprovada pelo validador. Reprovada vai para o log com o motivo; aprovada segue direto para o disparo, sem nenhuma ação minha. O comando PAUSAR no meu privado ou o botão do painel param tudo na hora; RETOMAR volta.
T5.4 Disparo: POST /disparo agenda as que passaram na checagem nos horários de REGRAS-DE-ENVIO.md, respeita os limites, chama o gateway e grava em envios.
T5.5 Preço revalidado logo antes de enviar: se subiu ou o produto acabou, cancela e me avisa.
T5.6 Escuta o webhook de failover do gateway: grava o evento numero_banido e me alerta no privado.
T5.7 Travas automáticas de CONTRATO.md: teto diário de gasto, teto de mensagens por grupo e pausa sozinha em anomalia, com alerta no meu privado.

## Aceite
- Uma oferta real do piloto passa na checagem e sai sozinha no grupo de teste no horário certo; uma oferta com defeito forçado é reprovada com o motivo.
- PAUSAR para todos os envios em menos de 1 minuto.
- Um clique pelo celular aparece na tabela cliques com o grupo correto.
- Uma oferta com preço alterado antes do envio é cancelada.
```

---

## Prompt 6 · Painel com dados reais

```text
# Prompt 6 · Painel com dados reais

Leia docs/PAINEL.md (aprovado no Prompt 1), docs/DECISOES.md e a bíblia. Repositório: achadinhos. Mantenha o design system já publicado.

## Tarefas
Ligue cada tela aos dados reais, seguindo docs/PAINEL.md:
T6.1 Visão geral: ofertas do dia, cliques, conversões, comissão estimada e saúde dos números.
T6.2 Nichos: criar, ativar e pausar; palavras-chave, faixa de preço, desconto mínimo, grupos de destino, template e modelo de LLM.
T6.3 Checagens: ofertas enviadas e reprovadas com o motivo, e o botão Pausar tudo visível em todas as telas.
T6.4 Ofertas: histórico com filtros e a curva de preço de cada produto.
T6.5 Grupos: horários, limites, link de convite e link wa.me de entrada. Números: status, QR de pareamento e promover reserva.
T6.6 Links e cliques: por oferta, grupo e horário. Conversões: lista por oferta e grupo.
T6.7 Bíblia: editor de markdown com versões e as propostas pendentes para aprovar ou recusar.
T6.8 Log dos agentes: eventos e conversas em tempo real, com filtro por agente.
T6.9 Auditoria em toda ação do painel.

## Aceite
- Todas as telas funcionam no celular e no computador.
- Mudar o desconto mínimo de um nicho afeta a próxima coleta.
- Aprovar uma proposta cria uma nova versão do documento na bíblia.
```

---

## Prompt 7 · Agentes ligados às ferramentas

```text
# Prompt 7 · Agentes do OpenBot ligados ao worker

Leia docs/DECISOES.md (como o OpenBot chama ferramentas), AGENTES.md e ROTINA.md da bíblia. Repositório: achadinhos, pasta openbot.

## Tarefas
T7.1 Exponha os endpoints do worker como ferramentas no formato que o OpenBot aceita, com descrição e schema claros. Permissão mínima por agente: Garimpeiro só coleta, Disparador só disparo, Coordenador bíblia, propostas e números.
T7.2 Versione em openbot/ a configuração dos 6 agentes criados na instalação (instruções vindas de AGENTES.md), para recriar a equipe do zero se precisar.
T7.3 Rotina agendada conforme ROTINA.md: o Coordenador abre o dia, depois Garimpeiro, Monitor, Arte e Copywriter, depois a checagem automática, o Disparador envia e o Coordenador fecha o dia com um resumo no meu WhatsApp.
T7.4 Modelos por agente via OpenRouter: barato para tarefas mecânicas, melhor para Coordenador e Copywriter, sempre com um modelo reserva. Grave o custo de cada chamada por agente.
T7.5 Os agentes conduzem o ciclo pelas rotinas do OpenBot. Se o OpenBot ficar fora do ar por mais de 30 minutos, os jobs do worker rodam o ciclo reserva com as regras atuais e me avisam.
T7.6 Propostas: um agente sugere uma mudança (ex.: horário com mais cliques), e o Coordenador aprova sozinho e registra no log. Mudanças que afetam gasto ou grupos entram no resumo diário.

## Aceite
- Um dia inteiro roda só pelos agentes, sem nenhuma ação minha.
- O resumo diário chega no meu WhatsApp.
- Desligar o OpenBot ativa o ciclo reserva do worker.
```

---

## Prompt 8 · Conversões, qualidade e go-live

```text
# Prompt 8 · Conversões, qualidade e go-live

Leia pacote/CONTRATO.md, pacote/COMECE-AQUI.md, docs/BRIEF.md, docs/DECISOES.md e METRICAS.md. Repositório: achadinhos.

## Tarefas
T8.1 Conversões: Shopee pelo conversionReport da Open API, uma vez por dia. Ligue cada conversão à oferta e ao grupo, lendo os subIds no campo utmContent. Mercado Livre fica para a fase 2.
T8.2 Métricas: taxa de clique por grupo, nicho e horário; comissão por oferta; custo de LLM por oferta enviada.
T8.3 Testes de ponta a ponta do ciclo completo com adaptadores e gateway falsos.
T8.4 Segurança e operação: gitleaks, rate limit em /r, snapshot diário do banco na Vertra e alertas no meu WhatsApp para falhas.
T8.5 Documentação: docs/README.md, docs/OPERACAO.md (manual do dia a dia) e docs/ARQUITETURA.md atualizado.

## Aceite
Todos os itens de "Pronto quando" em pacote/COMECE-AQUI.md.

## Relatório final
URLs, SHA, custos mensais estimados (Vertra e LLM), pendências minhas e resumo de DECISOES.md.
```
