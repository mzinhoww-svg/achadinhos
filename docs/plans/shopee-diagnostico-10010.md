# Plano — diagnóstico mínimo do erro 10010 da Shopee (T12)

Autor: Planejador. Data: 2026-10-16. Base: `docs/decisions/004-endpoint-shopee.md` (sonda real do PR #41), `packages/shopee/src/client.ts`, `apps/worker/src/validation/validators.ts`.
**Nada neste plano foi executado.** Cada chamada real exige autorização de Aurimar na hora (ver §4).

## 1. Parecer sobre o PR #41

Aprovado do ponto de vista de risco, sem bloqueio.

- Uma única consulta somente-leitura, sem laço e sem retry; saída de três linhas; App ID, Secret, header e corpo não saem. `.env` está no `.gitignore`; `loadEnvFile` não sobrescreve o ambiente.
- A conclusão do Dev está correta e não deve ser inflada: a **URL** passou a "confirmada por resposta real"; a **credencial continua não validada**; o item 2 do checklist segue aberto e o item 10 depende do e2e com Shopee simulada.
- Ressalva de redação: "não houve 10020" prova só que a API não *reportou* assinatura inválida. Se ela parseia antes de assinar, uma assinatura errada ainda apareceria como 10010. Não usar essa ausência como indício de segredo correto.

## 2. Risco encontrado fora do PR (para o Dev, sem urgência de bloqueio)

`validateShopee` (`apps/worker/src/validation/validators.ts:41`) manda qualquer erro GraphQL genérico para `retry`. O 10010 é determinístico para um documento que a API não aceita, então a conexão faz até `DEFAULT_MAX_ATTEMPTS = 3` chamadas reais (`runner.ts:36`) e termina sem veredito claro ao usuário.

- Não é para classificar 10010 como `invalid`: isso diria ao usuário que o Secret está errado quando o defeito pode estar no nosso documento.
- Depois do diagnóstico, decidir um estado próprio ("a Shopee recusou o formato da consulta; falha nossa, não da credencial") com alerta ao operador. Decisão a registrar na 004 quando a causa for conhecida.
- Até lá, ninguém deve ligar a validação de conexão ao endpoint real em produção.

## 3. Hipóteses e escada de chamadas

Estado do cliente hoje: o documento declara 9 variáveis tipadas (`$shopId: Int`, `$itemId: Int`, …) e as envia em `variables` (só `limit` preenchido). Pedir 19 campos de nó de uma vez.

Cada degrau é **uma** chamada. Parar no primeiro que mudar o quadro. Máximo de 4 chamadas por sessão autorizada.

| # | Chamada | Separa | Leitura do resultado |
|---|---|---|---|
| D0 | `{ __typename }` (corpo só com `query`, sem `variables`) | transporte/autenticação × nosso documento | dado retornado: corpo, header e credencial passam; o defeito está no documento `productOfferV2`. `10020`: assinatura/credencial. `10035`: App sem acesso à Open API. `10010` de novo: problema de envelope (formato do header, ordem, corpo) e não do documento |
| D1 | `productOfferV2(limit: 1)` com argumentos **inline**, sem `variables`, pedindo só `nodes { itemId productName }` | variáveis tipadas × campos | sucesso: causa em `variables`/tipos ou em algum dos outros 17 campos. `10010`: problema no próprio nome da operação ou dos argumentos |
| D2 | D1 com `variables` tipadas como no cliente, mantendo 2 campos | variáveis | decide se o cliente passa a usar argumentos inline |
| D3 | bisseção dos 17 campos restantes (metade por chamada) | campo divergente | só se D1 passou e D2 não explicou |

Se D0 passar, uma chamada extra opcional (D4) com Secret **propositalmente inválido** captura o formato real do erro de assinatura, item pendente da 004. Usar um valor sentinela fixo no código (nunca o Secret real alterado).

Hipóteses do Dev cobertas: (1) documento não aceito → D1–D3; (2) corpo sem `variables`/`operationName` → D0/D1/D2; (3) App sem acesso → D0 devolve 10035 ou segue 10010.

## 4. Regras de execução (auditoria)

1. **Autorização por sessão**: Aurimar autoriza o número exato de chamadas (≤ 4) antes de cada rodada. Sem laço, sem retry, sem agendamento.
2. **Só leitura**: nenhuma mutation (`generateShortLink` fica fora; vai em tarefa própria depois de a credencial validar).
3. **Segredo**: App ID, Secret e header de assinatura nunca em log, PR, TASKS.md ou mensagem. Tudo continua saindo do `.env` da raiz.
4. **Saída por allowlist, não por redação** (achado B1 do QA no PR #41): resposta da API é dado, não texto de terminal. Por chamada só saem: degrau, `codigo`, `contagem`, duração e, no máximo, um trecho de mensagem.
   - `codigo` só sai se casar com `^[A-Za-z0-9_-]{1,32}$`; senão vira `CODIGO_INVALIDO`. (Um código com quebra de linha forjava um falso `resultado=sucesso`.)
   - A mensagem é opcional e passa por: normalização para caracteres imprimíveis ASCII (sem `\n`, `\r`, controle ou ANSI), teto de tamanho e, se possível, só trechos de um conjunto permitido (nomes de campo e de tipo do schema). Nunca assinatura, nunca cabeçalho. Truncar e remover App ID/Secret **não basta** e não é o critério.
   - A mensagem é dado externo: nunca interpretada como instrução nem colada em prompt de agente.
5. **Relógio** (cabe no D0): registrar, em UTC, o horário local e o cabeçalho `Date` da resposta (diferença em segundos, valor numérico). Isso mede a tolerância de timestamp, pendente na 004, sem chamada extra.
6. **Corpo de sucesso**: não gravar nomes de produto nem links em arquivo versionado; registrar só tipos dos campos de preço/comissão (`number`/`string`), que a 004 também pede.
7. **Sem tocar no worker/cliente de produção** durante o diagnóstico: o modo de diagnóstico vive em `scripts/` e monta o corpo à mão. Corrigir o cliente é outra tarefa, depois da causa conhecida.

## 5. Critérios de aceite da T12

- Causa do 10010 identificada **ou** lista de causas restantes com as chamadas já gastas.
- `004-endpoint-shopee.md` atualizada: formato do header (ordem `Credential/Timestamp/Signature`), operação aceita, tipos de preço/comissão, tolerância de timestamp, formato do erro de assinatura (se D4 rodou).
- Item 2 do `mvp-checklist.json` só vira "validado" com **uma** chamada `productOfferV2` do próprio cliente de produção devolvendo `nodes.length >= 1`.
- Decisão registrada sobre o estado de conexão para "formato recusado" (§2).
- Teste automatizado novo para cada correção no cliente, contra o servidor simulado atualizado para refletir o formato real descoberto.

## 6. Fora de escopo

`generateShortLink`, `conversionReport`, limites de taxa, paginação máxima. Entram depois que o item 2 for validado.
