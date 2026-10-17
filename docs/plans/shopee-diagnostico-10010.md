# Plano — diagnóstico mínimo do erro 10010 da Shopee (T12)

Autor: Planejador. Data: 2026-10-16. Base: `docs/decisions/004-endpoint-shopee.md` (sonda real do PR #41), `packages/shopee/src/client.ts`, `apps/worker/src/validation/validators.ts`.
**Nada neste plano foi executado.** Cada chamada real exige autorização de Aurimar na hora (ver §4).

## 1. Parecer sobre o PR #41

Aprovado do ponto de vista de risco **após a correção do B1 do QA (`codigo` sem filtro na saída), em `0cc1e01`**. Não houve aprovação na primeira versão.

- Uma única consulta somente-leitura, sem laço e sem retry; saída enxuta e fixa; App ID, Secret, header e corpo da resposta não saem (a partir de `0cc1e01`, o `codigo` também passa por allowlist). `.env` está no `.gitignore`; `loadEnvFile` não sobrescreve o ambiente.
- A conclusão do Dev está correta e não deve ser inflada: a **URL** passou a "confirmada por resposta real"; a **credencial continua não validada**; o item 2 do checklist segue aberto e o item 10 depende do e2e com Shopee simulada.
- Ressalva de redação: "não houve 10020" prova só que a API não *reportou* assinatura inválida. Se ela parseia antes de assinar, uma assinatura errada ainda apareceria como 10010. Não usar essa ausência como indício de segredo correto.

## 2. Risco encontrado fora do PR (para o Dev, sem urgência de bloqueio)

`validateShopee` (`apps/worker/src/validation/validators.ts:41`) manda qualquer erro GraphQL genérico para `retry`. O 10010 é determinístico para um documento que a API não aceita, então a conexão faz até `DEFAULT_MAX_ATTEMPTS = 3` chamadas reais (`runner.ts:36`) e termina sem veredito claro ao usuário.

- Não é para classificar 10010 como `invalid`: isso diria ao usuário que o Secret está errado quando o defeito pode estar no nosso documento.
- Depois do diagnóstico, decidir um estado próprio ("a Shopee recusou o formato da consulta; falha nossa, não da credencial") com alerta ao operador. Decisão a registrar na 004 quando a causa for conhecida.
- Até lá, ninguém deve ligar a validação de conexão ao endpoint real em produção.

## 3. Hipóteses e escada de chamadas

Estado do cliente hoje: o documento declara 9 variáveis tipadas (`$shopId: Int`, `$itemId: Int`, …) e as envia em `variables` (só `limit` preenchido). Pedir 19 campos de nó de uma vez.

Cada degrau tem **teto próprio de chamadas** e exige autorização própria de Aurimar, com o número exato. Parar no primeiro que mudar o quadro.

| Degrau | Teto de chamadas | Observação |
|---|---|---|
| D0 | 1 | já executado (OK) |
| D1 | 1 | |
| D2 | 1 | |
| D3 | até 5 por rodada (⌈log₂17⌉ = 5 no melhor caso, para um único campo ruim) | cada rodada de D3 é autorizada à parte; mais de um campo ruim ou D3 inconclusivo exige nova autorização com novo teto |
| D4 | 1 | autorização própria (ver abaixo) |
| Tolerância de timestamp | fora desta escada | exige timestamps defasados de propósito; é outra rodada, com teto e autorização próprios, só se a 004 precisar do valor |

Não existe teto global de "4 por sessão": o limite é por degrau e por autorização.

| # | Chamada | Separa | Leitura do resultado |
|---|---|---|---|
| D0 | `{ __typename }` (corpo só com `query`, sem `variables`) | transporte/envelope × nosso documento | dado retornado: o **envelope é aceito e o transporte funciona**; o defeito provável está no documento `productOfferV2`. **Não prova credencial nem assinatura** (a credencial só se prova quando `productOfferV2` devolver `nodes`, como no §5): a API pode responder `__typename` sem autenticar. Quem decide isso é o D4. `10020`: assinatura/credencial. `10035`: App sem acesso à Open API. `10010` de novo: problema de envelope (formato do header, ordem, corpo) e não do documento |
| D1 | `productOfferV2(limit: 1)` com argumentos **inline**, sem `variables`, pedindo só `nodes { itemId productName }` | variáveis tipadas × campos | sucesso: causa em `variables`/tipos ou em algum dos outros 17 campos. `10010`: problema no próprio nome da operação ou dos argumentos. **Falso sinal possível**: se a API exigir `page` ou outro argumento obrigatório, o `10010` do D1 não condena o nome da operação; tratar um `10010` no D1 como "inconclusivo" até a mensagem (pelo modelo fixo do §4.4) indicar o argumento ausente |
| D2 | D1 com `variables` tipadas como no cliente, mantendo 2 campos | variáveis | decide se o cliente passa a usar argumentos inline |
| D3 | bisseção dos 17 campos restantes (metade por chamada) | campo divergente | só se D1 passou e D2 não explicou |

Se D0 passar, o **D4** (mesma consulta `{ __typename }` com Secret **propositalmente inválido**) deixa de ser opcional: separa "a API autentica antes de responder" de "a API não autentica `__typename`". `10020` ⇒ D0 provou credencial e assinatura; `OK` ⇒ D0 não provou nada sobre credencial e só o D1+ pode provar. Também captura o formato real do erro de assinatura, item pendente da 004. **O D4 é a única chamada que pode contar como tentativa de assinatura inválida no lado da Shopee**: precisa de autorização própria e explícita, separada da do D1. No D0, `contagem` conta campos de `data`, não ofertas. Usar um valor sentinela fixo no código (nunca o Secret real alterado).

Hipóteses do Dev cobertas: (1) documento não aceito → D1–D3; (2) corpo sem `variables`/`operationName` → D0/D1/D2; (3) App sem acesso → D0 devolve 10035 ou segue 10010.

## 4. Regras de execução (auditoria)

1. **Autorização por rodada**: Aurimar autoriza os degraus e o número exato de chamadas de cada um (teto por degrau no §3) antes de cada rodada. Sem laço, sem retry, sem agendamento.
2. **Só leitura**: nenhuma mutation (`generateShortLink` fica fora; vai em tarefa própria depois de a credencial validar).
3. **Segredo**: App ID, Secret e header de assinatura nunca em log, PR, TASKS.md ou mensagem. Tudo continua saindo do `.env` da raiz.
4. **Saída por allowlist, não por redação** (achado B1 do QA nos PRs #41 e #42): resposta da API é dado, não texto de terminal. Por chamada só saem: degrau, `codigo`, `contagem`, duração e, no máximo, uma mensagem **que case com um modelo fixo**.
   - `codigo` só sai se casar `^[A-Za-z0-9_-]{1,32}$`; senão vira `CODIGO_INVALIDO`. (Um código com quebra de linha forjava um falso `resultado=sucesso`.)
   - **Mensagem (critério fechado, obrigatório):** só sai se casar com um modelo fixo de erro GraphQL: `Syntax Error`, `Unknown argument`, `Unknown field`, `Unknown type` ou `Variable … of type`. Dentro do modelo, só saem tokens que sejam **identificadores presentes no nosso próprio documento enviado** (nomes de campo, argumento, tipo e variável que nós escrevemos). Qualquer outra mensagem, ou qualquer token fora desse conjunto, vira `MENSAGEM_OMITIDA (tamanho=N)`, com N só o tamanho. Normalizar ASCII e truncar **não são critério**: uma API que ecoa `Authorization` ou parte da query numa mensagem tem que cair em `MENSAGEM_OMITIDA`.
   - Cinto extra: se um identificador nosso coincidir com App ID ou Secret, a mensagem é omitida. Nunca assinatura, nunca cabeçalho.
   - A mensagem é dado externo: nunca interpretada como instrução nem colada em prompt de agente.
5. **Relógio** (cabe no D0): registrar, em UTC, o horário local e o cabeçalho `Date` da resposta (diferença em segundos, valor numérico). Isso mede o **deslocamento entre os relógios**, não a tolerância: a janela de timestamp que a API aceita **segue desconhecida** e só se mede mandando timestamps defasados de propósito (outra rodada, ver tabela do §3).
6. **Corpo de sucesso**: não gravar nomes de produto nem links em arquivo versionado; registrar só tipos dos campos de preço/comissão (`number`/`string`), que a 004 também pede.
7. **Sem tocar no worker/cliente de produção** durante o diagnóstico: o modo de diagnóstico vive em `scripts/`. Como um script cru perderia as proteções do `ShopeeClient` (`validateEndpoint`, timeout, teto de corpo, tratamento de resposta não-2xx; só `sign` é exportada), o script **deve** ter, cada uma testada:
   - allowlist de host **antes de assinar** (o Secret nunca vai para fora de `*.shopee.com.br`; http só em loopback, para o servidor simulado);
   - `redirect: "manual"` (o `fetch` segue redirecionamento por padrão e levaria o cabeçalho assinado a outro host);
   - timeout;
   - leitura com **teto de corpo** (corta e cancela ao estourar);
   - **guarda de uma chamada por autorização**: um degrau por invocação (`--degrau Dn`), sem modo "todos"; degrau ausente, repetido ou não autorizado é **recusa local, sem envio**, e o valor recebido não é ecoado. Só os degraus autorizados existem no código.
   Alternativa aceita: uma função mínima e aditiva em `packages/shopee` que assina e envia um corpo dado reutilizando essas proteções. O PR #44 segue a primeira via (`scripts/diag-allowlist.ts` + `scripts/shopee-diag.ts`, só D0). Corrigir o cliente é outra tarefa, depois da causa conhecida.

## 5. Critérios de aceite da T12

- Causa do 10010 identificada **ou** lista de causas restantes com as chamadas já gastas.
- `004-endpoint-shopee.md` atualizada: formato do header (ordem `Credential/Timestamp/Signature`), operação aceita, tipos de preço/comissão, deslocamento do relógio (a tolerância de timestamp só se houver rodada própria), formato do erro de assinatura (se D4 rodou).
- Item 2 do `mvp-checklist.json` só vira "validado" com **uma** chamada `productOfferV2` do próprio cliente de produção devolvendo `nodes.length >= 1`.
- Decisão registrada sobre o estado de conexão para "formato recusado" (§2).
- Teste automatizado novo para cada correção no cliente, contra o servidor simulado atualizado para refletir o formato real descoberto.

## 6. Fora de escopo

`generateShortLink`, `conversionReport`, limites de taxa, paginação máxima. Entram depois que o item 2 for validado.
