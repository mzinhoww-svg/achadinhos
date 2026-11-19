# Comece aqui

Piloto do Achadinhos: Shopee, um nicho, um grupo. O Claude Code instala, o OpenBot conduz o time.

## 1 · Antes do Prompt 1 (você, à mão)
- [ ] Shopee Afiliados: conta aprovada e acesso à Open API (App ID e Secret).
- [ ] Chave do OpenRouter com limite mensal de gasto.
- [ ] Três chips com algumas semanas de uso normal: um ativo e dois reservas. Seu número pessoal fica só como dono do grupo.
- [ ] Um grupo no seu WhatsApp, com envio só para admins. Você continua dono.
- [ ] Um grupo de teste, só com os seus números, para o ensaio de 3 dias.
- [ ] Repositório vazio `mzinhoww-svg/achadinhos` no GitHub, conectado à Vertra.
- [ ] OpenBot aberto no seu computador. Deixe a máquina ligada nos horários de envio.
- [ ] Um nicho para o piloto, com 5 a 10 palavras-chave e uma faixa de preço.
- [ ] O texto da mensagem pronta do link wa.me de entrada no grupo.

Mercado Livre: nada agora. Entra na fase 2.

## 2 · Onde colar as chaves (nunca no chat)

| Onde | O quê |
| --- | --- |
| Vertra, app `worker` | `OPENROUTER_API_KEY`, `SHOPEE_APP_ID`, `SHOPEE_SECRET`, `SERVICE_TOKEN`, `WA_GATEWAY_TOKEN` |
| Vertra, app `painel` | `AUTH_SECRET`, `SERVICE_TOKEN` |
| Vertra, app `wa-gateway` | token de acesso do gateway (os chips pareiam por QR) |
| OpenBot, provedores | OpenRouter como endpoint compatível com OpenAI, com a sua chave |
| OpenBot, credenciais | `SERVICE_TOKEN` do worker, para os agentes chamarem as ferramentas |

O Claude Code cria as variáveis vazias e lista quais faltam. Você só cola os valores.

## 3 · Ordem
1. Abra o Claude Code no repositório `achadinhos`, anexe este zip e cole o Prompt 1 de PROMPTS.md.
2. Quando ele entregar a mensagem curta, cole no OpenBot e responda às perguntas do Coordenador. Em paralelo, responda às perguntas do Claude Code sobre o painel.
3. Siga com os Prompts 2 a 8, um por chat, só depois do aceite do anterior.

## 4 · Pronto quando
- [ ] Painel, worker e wa-gateway no ar na Vertra, OpenBot aberto no seu computador, CI verde.
- [ ] Os 11 documentos da bíblia versionados e editáveis pelo painel.
- [ ] Nenhuma oferta enviada sem passar na checagem automática, e o PAUSAR testado.
- [ ] Failover testado: um número derrubado de propósito e o reserva assumindo.
- [ ] Cliques e conversões ligados a oferta, grupo e horário.
- [ ] Custo de LLM por agente visível no painel, e travas automáticas testadas.
- [ ] Nenhum segredo no git e snapshot diário do banco ativo.

A licença do OpenBot é não comercial. Se o projeto passar a gerar comissão de forma recorrente, revise a licença.
