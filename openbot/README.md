# OpenBot no computador do Aurimar

O time de agentes do Achadinhos vive no OpenBot, no Mac do Aurimar. A Vertra não aceita o container dele (veja
`servidor-docker/CONTINGENCIA.md`). O Mac precisa ficar ligado e com o OpenBot aberto nos horários de envio.

## 1 · Instalar e abrir

1. Baixe em https://openbot.run/download e instale (arraste para Aplicativos).
2. Abra o OpenBot e entre com a sua conta (código por e-mail).

## 2 · Conectar o OpenRouter

1. Settings › Providers › **OpenRouter** › cole a chave do OpenRouter. Na versão atual ele é provedor nativo.
2. Se a opção não aparecer: More providers › **Custom OpenAI-compatible endpoint**, URL `https://openrouter.ai/api/v1`,
   com a mesma chave.
3. Os modelos usam o formato `lab/modelo` (ex.: `anthropic/claude-sonnet-5.5`). Quem escolhe o modelo de cada agente
   é você, na entrevista do Coordenador.

## 3 · Ligar os agentes ao worker (MCP)

O worker é um servidor MCP em `https://achadinhos-worker.vertraweb.app/mcp`. Cada agente tem o próprio token e só vê as
ferramentas da sua função. No painel, tela **Agentes**, copie a configuração de cada um e cadastre no OpenBot em
Settings › MCP servers › Add › HTTP (header `Authorization: Bearer <token>`). Nunca cole token na conversa.

A equipe inteira (instruções, modelos, ferramentas e rotinas) está versionada em `equipe.json` e `agentes/`. Para
recriar do zero, siga `RECRIAR.md`.

## 4 · Mandar o pacote

Abra a conversa com um agente, cole a mensagem abaixo e envie:

```
Quero instalar a operação Achadinhos. Leia pacote/LEIA-ME.md e siga pacote/PROMPT_INSTALACAO.md do começo ao fim, falando comigo em português. Worker: https://achadinhos-worker.vertraweb.app.
```

Se o OpenBot não tiver acesso à pasta do repositório, junte à mensagem o conteúdo dos quatro arquivos de `pacote/`
(LEIA-ME, COMECE-AQUI, PROMPT_INSTALACAO e CONTRATO).

## Como o OpenBot funciona (resumo de `docs/DECISOES.md`, D-008)

- **Agentes:** criados por conversa (`create_agent`), cada um com instruções e workspace próprios.
- **Ferramentas:** servidores MCP cadastrados no app, terminal do agente (HTTP), skills e ACP.
- **Credenciais:** no cofre do OpenBot.
- **Rotinas:** por horário ou por webhook assinado (Standard Webhooks).

## `servidor-docker/`

Kit para rodar o OpenBot num VPS Linux com Docker, se o Mac deixar de servir: imagem oficial, gateway web com login de
admin e acesso MCP/REST por token, `vps/compose.yaml` com o seccomp oficial e Caddy para HTTPS. Não está em uso.
