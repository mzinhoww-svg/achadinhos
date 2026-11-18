# OpenBot na Vertra Cloud — estado da execução

Sem segredos neste arquivo. Atualizado: 2026-11-18 (UTC).

## Recursos criados

| Recurso | ID | Estado |
| --- | --- | --- |
| Imagem `openbot-vertra` | `62332720-1b88-45ee-b559-a5233bace468` | v2 (com gateway) build `success` 13:41 UTC, 3.192.168.780 bytes, porta 8080, `auto_update_apps: false` |
| App `openbot-vertra-hml` (worker, `web: false`, 1536 MB) | `11e7b75e-0c0f-4c47-9922-5b532c23dafd` | **parada** (crash loop: userns recusado) |

Nenhuma aplicação existente foi alterada (revela-face-engine, wa-gateway, agencia-worker, agencia-web, agencia-db).

## Progresso

1. MCP remoto `Vertra` (https://mcp.vertracloud.app/mcp) já estava conectado como conector do claude.ai: não foi duplicado.
2. MCP local `@vertracloud/mcp@0.3.6` testado via stdio (`create_image` existe só nele). Chave da API guardada como
   segredo de rede do ambiente cloud (injetada pelo proxy em `api.vertracloud.app`); nunca gravada em arquivo.
   Node precisa de `NODE_USE_ENV_PROXY=1` atrás do proxy.
3. Auditoria Vertra: plano pro-4 (4096 MB; 2560 em uso; 1536 livres), 2 slots de imagem, 4 vCPU/app, 10 GB disco/app,
   snapshots diários (30 dias) + manuais. Runtime: UID 1000:1000, `/app` persistente, `/tmp` `/var/tmp` `/run`
   graváveis temporários, resto somente leitura. A documentação NÃO oferece opção de seccomp, `--shm-size`,
   capabilities ou `exec`/terminal via API.
4. Auditoria OpenBot 0.72.0: o entrypoint oficial (`scripts/hosting/openbot-container`) exige
   `unshare --user --map-root-user true` (requisito OBRIGATÓRIO; sem isso ele encerra). `/dev/shm` ≥ 1 GiB é
   otimização (abaixo disso usa `/tmp` com `--disable-dev-shm-usage`). Estado em `$HOME` (upstream `/data`).
5. Imagem derivada criada com sucesso (FROM digest oficial; HOME=/app; wrapper de claim). Sem `--no-sandbox`.
6. App de homologação criada às 13:03 UTC como worker. Às 13:42 UTC continuava em `building` /
   `installing: true`, sem logs e sem release. `stop`, `restart` e `publish` respondem `409 APP_BUILDING`;
   a única ação aceita é excluir, e a chave usada não tem `apps:delete`.
7. Pedido novo: interface web com e-mail e senha de admin + acesso por outro chat. Gateway em `gateway/`
   (Node built-ins, MCP + REST com token, admin com scrypt). Testado localmente contra mocks do socket de
   controle e da Local scripts API (login, CSRF, rate limit, MCP, REST, UI no Chromium). Imagem v2 construída.
8. 13:46 UTC: a app saiu de `building` e iniciou (imagem v1). Log: `user namespaces REFUSED by the runtime`, seguido
   da mensagem oficial do OpenBot e de 3 reinícios. App parada às 13:48 UTC.
   **Resultado: Vertra incompatível (sandbox do Electron). NÃO HOMOLOGADA.** Ver `CONTINGENCIA.md`.
9. Contingência pronta em `vps/` (mesma imagem e mesmo gateway, seccomp oficial, Caddy). Nada contratado.

## Retomar

```sh
cd openbot-vertra
# status da app
curl -sS https://api.vertracloud.app/v1/apps/11e7b75e-0c0f-4c47-9922-5b532c23dafd/status
```
