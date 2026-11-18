# Deploy na Vertra

| App                       | URL                                     | Memória | Como sobe                                         |
| ------------------------- | --------------------------------------- | ------- | ------------------------------------------------- |
| `achadinhos-worker`       | https://achadinhos-worker.vertraweb.app | 512 MB  | `node worker.mjs` (arquivo único, sem instalação) |
| `achadinhos-painel`       | https://achadinhos-painel.vertraweb.app | 768 MB  | `npm install` → `npm run build` → `npm start`     |
| `wa-gateway` (já existia) | https://wa-gateway-revela.vertraweb.app | 512 MB  | —                                                 |

Saúde: `GET /health` (worker) e `GET /api/health` (painel). Os dois respondem 200, com `ok` e o motivo no corpo.

## 1 · O que o Aurimar cola (nunca no chat)

As variáveis já existem nas apps com o valor `PENDENTE`. Troque pelo valor real no painel da Vertra (app ›
Variáveis) e reinicie a app.

### Gere dois segredos no seu computador

No Terminal do Mac:

```sh
openssl rand -hex 32   # SERVICE_TOKEN  (o mesmo no worker, no painel e no OpenBot)
openssl rand -hex 32   # AUTH_SECRET    (só no painel)
```

### `achadinhos-worker`

| Variável                                             | Valor                                                                                                                  |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                       | `postgresql://USUARIO:SENHA@38496aaf14b145da9f2eb78e85297dec.db.usa1.vertraweb.app:51775/vertracloud` (veja o passo 2) |
| `DB_SSL_CA_B64`, `DB_SSL_CERT_B64`, `DB_SSL_KEY_B64` | Os mesmos valores das variáveis de mesmo nome da app `agencia-worker` (certificados do banco)                          |
| `DB_SSL_MODO`                                        | já preenchida: `verify-ca`                                                                                             |
| `SERVICE_TOKEN`                                      | o primeiro valor gerado acima                                                                                          |
| `ADMIN_EMAIL`                                        | o seu e-mail de login no painel                                                                                        |
| `ADMIN_SENHA_INICIAL`                                | uma senha de 12 ou mais caracteres. **Apague depois do primeiro login.**                                               |
| `OPENROUTER_API_KEY`                                 | a chave do OpenRouter, com limite mensal de gasto                                                                      |
| `SHOPEE_APP_ID`, `SHOPEE_SECRET`                     | credenciais da Open API de Afiliados da Shopee                                                                         |
| `WA_GATEWAY_TOKEN`                                   | o token de acesso do wa-gateway                                                                                        |
| `WA_GATEWAY_URL`                                     | já preenchida                                                                                                          |

### `achadinhos-painel`

| Variável        | Valor                        |
| --------------- | ---------------------------- |
| `SERVICE_TOKEN` | o mesmo do worker            |
| `AUTH_SECRET`   | o segundo valor gerado acima |
| `WORKER_URL`    | já preenchida                |

## 2 · Usuário do banco (recomendado)

O `agencia-db` também guarda os dados da agência de vistos. Um usuário próprio isola o Achadinhos. Na Vertra, abra o
banco › aba Data › console SQL e rode, trocando a senha:

```sql
CREATE ROLE achadinhos LOGIN PASSWORD 'troque-por-uma-senha-forte';
GRANT CONNECT, CREATE ON DATABASE vertracloud TO achadinhos;
```

O worker cria sozinho os schemas `achadinhos` e `achadinhos_fila`, que ficam com esse usuário como dono. Ele não
enxerga as tabelas da agência. Use `achadinhos` e a senha na `DATABASE_URL`.

Se o `CREATE ROLE` for recusado (o usuário `vertracloud` pode não ter essa permissão), use o usuário `vertracloud` e
a senha do banco na `DATABASE_URL`. Funciona do mesmo jeito, só sem o isolamento.

## 3 · Conferir

```sh
curl https://achadinhos-worker.vertraweb.app/health
# {"ok":true,"banco":true,"fila":true,"listen":true,"pronto":true,...}
```

Depois, entre em https://achadinhos-painel.vertraweb.app com `ADMIN_EMAIL` e `ADMIN_SENHA_INICIAL`.

## 4 · Novo deploy (quem desenvolve)

```sh
pnpm install
pnpm empacotar           # gera deploy/worker e deploy/painel
```

Envie cada pasta para a app correspondente: pelo MCP local da Vertra (`deploy_app`), pela API
(`POST /v1/apps/{id}/files/upload`, com o zip da pasta) ou pelo painel da Vertra (upload de zip). As migrações do
banco rodam sozinhas no boot do worker.

IDs: worker `8db75cd7-f209-4798-8a4f-2e6a26b9a3c5`, painel `9fda467f-7bac-476e-b109-177dd549b8d9`.
