# API do worker (interface construída)

Base: `https://achadinhos-worker.vertraweb.app`. Toda rota, menos `/` e `/health`, exige o header
`X-Service-Token: <SERVICE_TOKEN>`. Corpo e resposta em JSON. Erros: `{ "erro": "<codigo>", "mensagem": "..." }`.
Entrada inválida responde 400 com `detalhes`. A lista viva fica em `GET /ferramentas`.

## Prontas

| Método e rota                           | Quem chama           | O que faz                                                                                                               |
| --------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `GET /health`                           | todos                | `{ ok, banco, fila, listen, pronto, erro }`, sempre 200                                                                 |
| `GET /biblia`                           | todos                | Última versão de cada documento (sem o conteúdo)                                                                        |
| `GET /biblia/:slug[?versao=N]`          | todos                | Um documento (atual ou versão N)                                                                                        |
| `GET /biblia/:slug/versoes`             | todos                | Histórico de versões                                                                                                    |
| `POST /biblia`                          | Coordenador          | Nova versão: `{ slug, titulo?, conteudo, autor, motivo? }` → 201                                                        |
| `GET /propostas[?status=aberta]`        | todos                | Propostas                                                                                                               |
| `POST /propostas`                       | todos                | `{ titulo, descricao, autor, docSlug?, conteudoProposto? }` → 201                                                       |
| `POST /propostas/:id/decidir`           | Coordenador, Aurimar | `{ decisao: "aprovada"\|"rejeitada", decididoPor, comentario? }`. Aprovada com documento grava a nova versão da bíblia. |
| `POST /eventos`                         | todos                | `{ tipo: "oferta.criada", agente, dados?, ofertaId? }` → 201                                                            |
| `GET /eventos[?desde=ID&tipo=&limite=]` | todos                | Eventos (com `desde`, em ordem crescente)                                                                               |
| `GET /eventos/stream[?desde=ID]`        | painel, agentes      | Fluxo SSE em tempo real (LISTEN/NOTIFY)                                                                                 |
| `POST /auth/login`                      | painel               | Confere a senha do admin                                                                                                |

O slug aceita `TOM-DE-VOZ` ou `tom-de-voz.md`. Os 11 documentos esperados estão em `packages/shared/src/biblia.ts`.

Exemplo:

```sh
curl -X POST https://achadinhos-worker.vertraweb.app/biblia \
  -H "X-Service-Token: $SERVICE_TOKEN" -H "Content-Type: application/json" \
  -d '{"slug":"NICHOS","titulo":"Nichos","conteudo":"# Nichos\n\nVersão 1 · 18/11/2026\n...","autor":"Coordenador"}'
```

## Coleta, preços e ofertas (Prompt 2)

| Método e rota                              | Quem chama  | O que faz                                                                                                                                                                                                |
| ------------------------------------------ | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /nichos`                              | todos       | Nichos com palavras-chave e regras de oferta                                                                                                                                                             |
| `POST /nichos`                             | Coordenador | Cria ou atualiza pelo nome: `{ nome, palavras[], precoMin?, precoMax?, descontoMinPct? (15), avaliacaoMin? (4.5), vendasMin? (50), ativo?, autor? }`                                                     |
| `POST /coleta/buscar`                      | Garimpeiro  | `{ nichoId \| nicho, paginas? (1-5), limite? (≤50) }`. Roda as palavras na Shopee, normaliza e grava (dedupe por marketplace + id). Devolve `{ produtos, novos, atualizados, observacoes, palavras[] }`. |
| `POST /monitor/rodar`                      | Monitor     | Rodada sob demanda (o job roda sozinho a cada 2 h): atualiza preço e estoque, grava o histórico e cria as candidatas.                                                                                    |
| `GET /precos/historico?produtoId=&dias=30` | Monitor     | Série de preços e mediana do período                                                                                                                                                                     |
| `GET /ofertas[?status=&nichoId=&limite=]`  | todos       | Ofertas, as de maior pontuação primeiro                                                                                                                                                                  |
| `POST /ofertas`                            | Monitor     | `{ produtoId }`. 201 se for oferta real; 422 `nao_e_oferta` com o motivo (`historico_insuficiente`, `desconto_insuficiente`, `avaliacao_baixa`, `vendas_baixas`); 409 se já houver oferta aberta.        |

Eventos gravados:

- `coleta.concluida`;
- `monitor.concluido`;
- `oferta_detectada`, com `ofertaId`, desconto, mediana e pontuação;
- `marketplace.erro`, com cada falha da Shopee (código, tentativa e se vai repetir);
- `nicho.salvo`.

Sem `SHOPEE_APP_ID` e `SHOPEE_SECRET`, a coleta e o Monitor respondem 503 com o motivo. Um nicho de Mercado Livre
responde 501 (fase 2).

## Arte (Prompt 3)

| Método e rota                                 | Quem chama      | O que faz                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /imagem/render`                         | Diretor de Arte | `{ ofertaId \| produtoId, formato?: quadrado \| retrato \| ambos (padrão), forcarFallback? }`. Baixa a foto oficial na maior resolução, recorta o fundo, padroniza, aplica o template do nicho e guarda as peças. 201 com `{ pecas[{ id, formato, url }], fotoOriginalUrl, mascaraUrl, confianca, fallback, motivoFallback, template, armazenamento }`. Com `produtoId` é uma prévia: o "de" é o preço cheio anunciado pela loja. 422 `sem_foto`/`sem_preco`, 502 `foto_indisponivel`. |
| `POST /imagem/lote`                           | painel          | `{ nichoId?, limite? (10, ≤20), formato?, forcarFallbackEm? }`. Responde 202 na hora e renderiza em segundo plano: ofertas abertas primeiro, depois os produtos com mais desconto anunciado.                                                                                                                                                                                                                                                                                           |
| `GET /imagens[?ofertaId=&produtoId=&limite=]` | painel          | Renderizações agrupadas (original, quadrado e retrato), as mais novas primeiro                                                                                                                                                                                                                                                                                                                                                                                                         |
| `GET /arquivos/<caminho>`                     | público         | Peças guardadas no banco enquanto não houver chave do Blob. Sem token.                                                                                                                                                                                                                                                                                                                                                                                                                 |

Regras:

- o produto é sempre a foto oficial: o recorte só torna o fundo transparente e a ampliação (menor lado abaixo de
  800 px) é interpolação Lanczos, sem IA;
- confiança do recorte abaixo de `ARTE_LIMIAR_CONFIANCA` (0,8) vai para o fallback: foto original inteira numa
  moldura, com `fallback: true` e o motivo;
- template: bloco ```json em `TEMPLATES-VISUAIS.md` (`{ "padrao": {...}, "nichos": { "<nome do nicho>": {...} } }`,
  campos `cores`, `marca`, `logo` em data URI, `posicaoSelo`); sem documento, vale o padrão laranja e branco.

Eventos: `arte.renderizada`, `arte.fallback`, `arte.erro` e `arte.lote_concluido`.

## Ciclo: copy, checagem, pausa, disparo e link curto (Prompt 5)

| Método e rota                                                                                                                    | Quem chama            | O que faz                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /pausa` · `POST /pausa {pausado, motivo?, autor?}`                                                                          | Coordenador, painel   | Pausa geral. O disparo confere antes de cada envio; também pausa e retoma por `PAUSAR`/`RETOMAR` no WhatsApp do dono.                                                             |
| `POST /ofertas/:id/copy`                                                                                                         | Copywriter            | 2 variações pelo LLM (modelo em `AGENTES.md`), validadas contra o banco (preço, desconto, nome, `#publi`, `{{link}}`). Sem chave ou acima do teto de gasto, usa o modelo fixo.    |
| `POST /ofertas/:id/checar`                                                                                                       | Checagem              | Reprova com o motivo (preço diferente, sem estoque, sem peça, fallback com baixa confiança, repetido, marca/palavra/nicho bloqueado, copy inválida). Aprovada é agendada na hora. |
| `POST /ofertas/:id/preparar`                                                                                                     | Coordenador           | Arte + copy + checagem + agendamento, numa chamada.                                                                                                                               |
| `GET /checagens`                                                                                                                 | painel                | Últimas checagens com os motivos.                                                                                                                                                 |
| `POST /disparo {ofertaId?, executar?}`                                                                                           | Disparador            | Agenda as aprovadas nos horários de `REGRAS-DE-ENVIO.md` (máximo por dia, 20 min entre mensagens, extras acima de 40%). `executar` manda o que já está na hora.                   |
| `GET /envios[?status=&dias=]` · `GET /travas`                                                                                    | painel                | Envios e estado das travas (pausa, gasto de LLM, reprovação do dia).                                                                                                              |
| `POST /links/:codigo/clique {ipHash, userAgent}`                                                                                 | painel (`/r/:codigo`) | Registra o clique e devolve o destino.                                                                                                                                            |
| `GET /grupos` · `POST /grupos` · `POST /grupos/:id/entrada`                                                                      | Coordenador, painel   | Grupos (JID, teste, horários, limite, nichos) e link `wa.me` de entrada.                                                                                                          |
| `GET /numeros` · `POST /numeros` · `POST /numeros/:id/pareamento` · `POST /numeros/:id/promover` · `POST /wa/pool {adminPhones}` | Coordenador, painel   | Pool de números no wa-gateway (status, QR, troca manual, telefones do dono).                                                                                                      |
| `POST /ensaio/oferta {nichoId?, descontoPct?, defeito?}`                                                                         | Coordenador           | Oferta falsa (foto e link de um produto real) que roda o ciclo inteiro, só para grupos de teste. `defeito: "preco"` força uma reprovação.                                         |
| `POST /wa/webhook?t=<token>`                                                                                                     | wa-gateway            | Eventos `pool.*`: confirmação de envio, comandos, banimento, failover, entrada. Público, protegido pelo token.                                                                    |

Jobs: `disparo-tick` (a cada minuto: revalida o preço e envia o que está na hora) e `ciclo-reserva` (a cada 15 min:
prepara as candidatas quando os agentes ficam 30 min sem chamar o worker com `x-origem: openbot`).

Travas automáticas (pausam e avisam no privado): 3 falhas de envio seguidas, mais de 20% de reprovação no dia (mínimo
de 5), número banido e pool sem número. O teto de US$ 1/dia e US$ 20/mês de LLM troca a copy pelo modelo fixo.

## Pendentes (respondem 501 com o motivo)

Nenhuma desde o Prompt 5.

Resposta: `{ "erro": "nao_implementado", "ferramenta", "quemChama", "motivo" }`.
