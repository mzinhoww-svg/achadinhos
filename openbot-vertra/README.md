# openbot-vertra

O OpenBot 0.72.0 (Nightly Labs) roda na Vertra Cloud, junto com um gateway que oferece:

- **interface web de admin** com e-mail e senha: estado do servidor, vínculo com a conta OpenBot (código por
  e-mail ou claim), QR do Mobile Connect, conversa com os agentes, respostas a perguntas e aprovações;
- **acesso para outro chat**: endpoint **MCP** (`/mcp`, Streamable HTTP) e **REST** (`/api/v1/...`), protegidos
  por um token Bearer.

O gateway só usa as interfaces locais oficiais do OpenBot: o socket de controle do comando `openbot`
(`scripts/hosting/openbot`) e a [Local scripts API](https://github.com/nightly-labs/openbot/blob/main/docs/automation.md)
em `127.0.0.1`. O código do OpenBot não é alterado, e o sandbox do Electron continua ligado.

## Arquitetura

```
navegador (admin)  ── HTTPS ──┐
outro chat (MCP/REST) ─ HTTPS ─┤  Vertra (subdomínio, TLS) ── :8080 gateway (Node, UID 1000)
                               │                                 ├─ unix socket /run/openbot/control.sock  → OpenBot
                               │                                 └─ http://127.0.0.1:<porta> Local scripts  → OpenBot
openbot.run/app, app do celular ── WebRTC/Signal/TURN (saída) ─────────────────────────────→ OpenBot
```

Os dados ficam em `/app`, que é o disco persistente da Vertra e faz o papel do `/data` da imagem oficial.

## Credenciais (geradas no SEU computador)

```sh
node tools/make-credentials.mjs voce@exemplo.com
```

O script pede a senha de admin sem mostrá-la na tela e imprime:

| Saída | Onde vai |
| --- | --- |
| `OBG_ADMIN_EMAIL`, `OBG_ADMIN_PASSWORD_HASH` (scrypt), `OBG_API_TOKEN_SHA256` | Variáveis da app na Vertra. São só hashes. |
| `obg_...` (token da API) | Gerenciador de senhas. Entregue só ao chat ou ferramenta que vai acessar os agentes. |

O servidor nunca recebe a senha nem o token, só os hashes. Para trocar a senha ou revogar o token, gere
novos valores, atualize as variáveis e reinicie a app. Sem essas variáveis, o login de admin e a API ficam
fechados.

## Primeiro uso

1. Abra `https://<subdominio>.vertraweb.app` e entre com o e-mail e a senha de admin.
2. Na aba **Servidor**, informe o e-mail da conta OpenBot, use o nome `OpenBot-Vertra` e digite o código
   recebido. Isso equivale a `openbot login`.
3. Em [openbot.run/app](https://openbot.run/app), com a mesma conta, selecione o servidor, conecte os provedores
   (Claude Code, Codex...) e crie os agentes.
4. Em cada agente que outro chat deve acessar, ligue **Configurações › Permissões › Local scripts**. Só agentes
   com essa opção aparecem no gateway.
5. No celular, use **Gerar QR do Mobile Connect** na aba Servidor.

## Outro chat acessando os agentes

```sh
# Claude Code (outra sessão ou outra máquina)
export OPENBOT_GATEWAY_TOKEN=obg_...           # do gerenciador de senhas
claude mcp add --transport http openbot-vertra https://<subdominio>.vertraweb.app/mcp \
  --header "Authorization: Bearer ${OPENBOT_GATEWAY_TOKEN}"
```

Ferramentas MCP: `list_agents`, `send_message` (com `wait_seconds` até 600), `get_delivery`, `get_pending`,
`answer_question`, `new_chat` e `server_status`.

REST:

| Método | Rota | Uso |
| --- | --- | --- |
| GET | `/api/v1/agents` | agentes com Local scripts |
| POST | `/api/v1/agents/:id/messages` | `{"text", "clientMessageId"?, "waitSeconds"?}` |
| GET | `/api/v1/agents/:id/deliveries/:deliveryId` | estado e resposta |
| GET | `/api/v1/agents/:id/pending` | perguntas e aprovações pendentes |
| POST | `/api/v1/agents/:id/prompts/:requestId/answer` | `{"answers": {"id": ["..."]}}` |
| POST | `/api/v1/agents/:id/context/clear` | nova conversa |

Aprovar comandos e trocar modelo ou conta de um agente ficam **só na interface de admin**, nunca com o token.
O OpenBot limita a 30 mensagens por agente por hora (ajustável em Server Settings › Agent defaults › Local scripts).

## Segurança

- Login de admin: scrypt, cookie `__Host-` HttpOnly/Secure/SameSite=Strict, sessão de 12 h (`OBG_SESSION_HOURS`),
  bloqueio de 15 min após 5 falhas por IP e teto global de 50 falhas a cada 15 min. Esse teto pode bloquear o
  próprio admin durante um ataque.
- Escritas no admin exigem o header `X-OBG` e a mesma origem (proteção contra CSRF). O CSP é estrito, sem scripts
  inline.
- O token é comparado pelo SHA-256 em tempo constante. IDs são validados antes de chegar ao OpenBot.
- Os agentes têm acesso total ao container (é o modelo do OpenBot). Eles rodam como o mesmo UID do gateway e
  podem ler o token local do OpenBot. Use senha forte e entregue o token só a quem pode comandar os agentes.
- A licença do OpenBot é PolyForm Noncommercial 1.0.0.

## Operação

| Tarefa | Como |
| --- | --- |
| Saúde | `GET /healthz` (sem segredos), a aba Servidor, as linhas `openbot-vertra status:` no log a cada 30 min, e `get_app_status` no MCP |
| Logs | `get_logs` no MCP da Vertra ou o painel |
| Backup | Snapshot diário automático da Vertra (30 dias). Para um backup consistente: parar a app → `create_snapshot` → iniciar. `/app` precisa ficar inteiro (keyring + senha + bancos). |
| Atualizar | Mudar o `FROM` para a nova versão (tag + digest), conferir `docker/seccomp.json` e `scripts/hosting/openbot-container` da release, fazer snapshot e depois `rebuild_image` + reiniciar a app |
| Reverter | Não volte o OpenBot para uma imagem antiga em cima de dados migrados. Restaure o snapshot anterior **com** a versão da imagem (`restore_snapshot`, opção de imagem). |
| Novos agentes | Criar em openbot.run/app e ligar Local scripts para expô-los ao gateway |

## Bloqueio conhecido

O entrypoint oficial exige `unshare --user` (user namespaces) para o sandbox do Electron. A Vertra não oferece
seccomp personalizado. O resultado aparece no log da primeira inicialização (`openbot-vertra: user namespaces ...`).
Se o runtime recusar, a implantação é incompatível e não deve ser forçada com `--no-sandbox`.
