# Recriar a equipe do Achadinhos no OpenBot

Tudo o que define a equipe está aqui: `equipe.json` (agentes, modelos, ferramentas e rotinas) e `agentes/*.md`
(instruções). Para montar do zero:

1. **OpenRouter:** Settings › Providers › OpenRouter › cole a chave (com limite mensal de gasto no site do OpenRouter).
2. **Servidores MCP:** no painel do Achadinhos, tela **Agentes**, copie a configuração de cada agente. No OpenBot,
   Settings › MCP servers › Add › HTTP, com a URL e o header `Authorization: Bearer <token>`. Um servidor por agente,
   com acesso só para aquele agente.
3. **Agentes:** peça ao agente principal do OpenBot, para cada item de `equipe.json`:
   > Crie o agente **<nome>** com estas instruções: (cole `agentes/_comum.md` + `agentes/<arquivo>.md`). Modelo
   > principal **<modelo.principal>**, reserva **<modelo.reserva>**, esforço **<esforco>**. Dê acesso só ao servidor
   > MCP achadinhos-<nome>.
4. **Rotinas:** para cada item de `rotinas` em `equipe.json`, crie uma rotina agendada (When to run › Schedule) no
   agente indicado, com a tarefa do item.
5. **Teste:** peça ao Coordenador `oferta_de_ensaio` e confira o envio no grupo de teste e o resumo das 21h.

## Ciclo reserva

Se os agentes ficarem 30 minutos sem chamar o worker, ele mesmo prepara as candidatas (arte, copy, checagem), agenda
as aprovadas e avisa o Aurimar uma vez por dia. Às 21h05, se o Coordenador não mandou o resumo, o worker manda.
