# OpenBot na Vertra Cloud — estado da execução

Sem segredos neste arquivo. Atualizado: 2026-11-18 (UTC).

## Recursos criados

| Recurso | ID | Estado |
| --- | --- | --- |
| Imagem `openbot-vertra` | `62332720-1b88-45ee-b559-a5233bace468` | build `success`, 3.021.030.578 bytes descompactada, `auto_update_apps: false` |
| App `openbot-vertra-hml` (worker, `web: false`, 1536 MB) | `11e7b75e-0c0f-4c47-9922-5b532c23dafd` | ver "Progresso" |

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
6. App de homologação criada; ficou em `building` / `installing: true` por mais de 26 minutos sem log
   (ver relatório final).

## Retomar

```sh
cd openbot-vertra
# status da app
curl -sS https://api.vertracloud.app/v1/apps/11e7b75e-0c0f-4c47-9922-5b532c23dafd/status
```
