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

## Pendentes (respondem 501 com o motivo)

`POST /coleta/buscar`, `GET /precos/historico`, `GET|POST /ofertas`, `POST /imagem/render`,
`POST /ofertas/:id/copy`, `POST /ofertas/:id/checar`, `GET|POST /pausa`, `POST /disparo` e `GET|POST /numeros`.

Resposta: `{ "erro": "nao_implementado", "ferramenta", "quemChama", "motivo" }`.
