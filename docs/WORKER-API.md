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

## Pendentes (respondem 501 com o motivo)

`POST /imagem/render`,
`POST /ofertas/:id/copy`, `POST /ofertas/:id/checar`, `GET|POST /pausa`, `POST /disparo` e `GET|POST /numeros`.

Resposta: `{ "erro": "nao_implementado", "ferramenta", "quemChama", "motivo" }`.
