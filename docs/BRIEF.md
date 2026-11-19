# Brief do Achadinhos

Contexto do prompt de instalação de 18/11/2026, para quem pegar o projeto depois.

## O que é

Sistema pessoal de pesquisa do Aurimar. Ele encontra ofertas reais na Shopee por nicho (o Mercado Livre entra na fase 2),
trata a foto real do produto, escreve a mensagem e publica em grupos de WhatsApp com link de afiliado.

## Quem faz o quê

- **OpenBot** (https://openbot.run), no computador do Aurimar, com um time de seis agentes: Coordenador, Garimpeiro,
  Monitor, Arte, Copywriter e Disparador. É lá que os agentes são criados, conversam entre si, guardam contexto, rodam
  rotinas e passam pelas checagens. **Os agentes não são recriados no Claude Code nem em outra ferramenta.**
- **Worker** (Vertra): o trabalho repetitivo (APIs, imagem, envio, métricas), exposto como ferramentas descritas em
  `pacote/CONTRATO.md`.
- **Painel** (Vertra): onde o Aurimar acompanha a operação e edita a bíblia.
- **wa-gateway** (Vertra, já existente): envio pelo WhatsApp (Baileys, vários números).
- **Postgres** (Vertra, `agencia-db`, schema `achadinhos`).

## Como foi pedido

1. **Parte 1 (Claude Code):** preparar a estrutura. Monorepo, banco, worker e painel mínimos, deploy na Vertra, pacote em
   `pacote/` e a mensagem para colar no OpenBot.
2. **Parte 1C (Claude Code, em paralelo):** entrevista do painel, `docs/PAINEL.md` e o esqueleto navegável de todas
   as telas, com dados falsos.
3. **Parte 2 (OpenBot):** seguir `pacote/PROMPT_INSTALACAO.md`. O Coordenador cria a equipe, entrevista o Aurimar e
   escreve os 11 documentos da bíblia.

## Regras

- Português, frases curtas. Pedir confirmação antes de criar algo pago ou irreversível na Vertra.
- Nunca pedir chaves no chat. Elas ficam nas variáveis da Vertra e nas credenciais do OpenBot.
- Não publicar nada nos grupos e não criar contas em nome do Aurimar.
- Registrar cada decisão em `docs/DECISOES.md`.
- Se algo falhar, explicar em uma frase o que aconteceu e o que ele pode fazer.

## Piloto

Shopee, um nicho, um grupo. Ensaio de 3 dias num grupo de teste antes dos grupos reais.
