# Resultado: Vertra Cloud INCOMPATÍVEL com o OpenBot (sandbox do Electron)

Classificação: **NÃO HOMOLOGADA / incompatível**. A instalação não foi forçada.

## 1. Requisito que impede a execução

O entrypoint oficial do OpenBot 0.72.0 (`scripts/hosting/openbot-container`, idêntico em `main`) executa:

```sh
unshare --user --map-root-user true 2>/dev/null ||
  fail "OpenBot cannot make a user namespace for the Electron sandbox. ..."
```

O sandbox do Chromium/Electron cria **user namespaces** (`clone`/`unshare` com `CLONE_NEWUSER`). O perfil seccomp
padrão do Docker recusa essas chamadas sem `CAP_SYS_ADMIN`. Por isso o projeto distribui `docker/seccomp.json`
(o perfil padrão do moby com uma regra a mais: `clone`/`unshare` sem filtro de flags) e diz para não usar
`seccomp=unconfined`, `--privileged` nem `--no-sandbox`.

## 2. Restrição encontrada na Vertra

- Apps de imagem própria rodam como `1000:1000`, com raiz somente leitura. A documentação (`get_docs`, seção 5) e a
  API (`create_app_from_image`, `update_app_config`) **não têm nenhuma opção** de seccomp, capabilities,
  `security_opt`, `--shm-size` ou privilégios.
- No runtime, a criação de user namespace é **recusada**.
- Outros dados observados: `/dev/shm` = 384 MB (o OpenBot tolera isso usando `/tmp`); o processo 1 é da
  plataforma, e o `tini` avisa que não é PID 1.

## 3. Evidência (log da app `openbot-vertra-hml`, 2026-11-18 13:46 UTC)

```
openbot-vertra: uid=1000 gid=1000 home=/app
openbot-vertra: /dev/shm 384M (OpenBot falls back to /tmp below 1 GiB)
openbot-vertra: user namespaces REFUSED by the runtime; the official entrypoint will stop.
OpenBot cannot make a user namespace for the Electron sandbox. Start the container with --security-opt seccomp=seccomp.json. ...
```

O ciclo se repetiu três vezes (13:46:45, 13:46:46 e 13:46:57: reinício automático da Vertra) e a app foi parada
manualmente para encerrar o crash loop. Antes disso, a app ficou ~43 min em `building`/`installing` sem log
(13:03 → 13:46).

## 4. Dá para resolver com configuração suportada?

**Não pela API nem pela documentação atuais.** Os únicos caminhos que fariam o container subir desligam a
segurança (`--no-sandbox`, rodar sem o entrypoint oficial) e estão fora do escopo pelos critérios da missão e
pelas regras do próprio OpenBot.

## 5. Pergunta para o suporte da Vertra

> Apps de imagem Docker própria (plano Pro 4, cluster 1) recusam `unshare(CLONE_NEWUSER)` para o UID 1000
> (`unshare --user --map-root-user true` falha). O Electron/Chromium precisa de user namespaces para o sandbox.
> 1) É possível aplicar um perfil seccomp personalizado (o perfil padrão do Docker + `clone`/`unshare` sem filtro de
> flags, igual a https://github.com/nightly-labs/openbot/blob/main/docker/seccomp.json) a uma aplicação?
> 2) O runtime usa gVisor/Kata/sysctl `user.max_user_namespaces=0` ou AppArmor que bloqueie userns?
> 3) É possível configurar `/dev/shm` de 1 GiB?
> 4) Por que a criação da app `11e7b75e-0c0f-4c47-9922-5b532c23dafd` ficou ~43 minutos em `installing` sem log?

Se a resposta for positiva para (1), basta recriar a app: imagem, gateway e documentação já estão prontos.

## 6. Alternativa mais econômica: VPS Linux com Docker

Requisitos: Ubuntu 24.04 (ou Debian 12), Docker Engine, IPv4 público, **4 GB de RAM ou mais** (o OpenBot roda 2
turnos simultâneos até 5 GiB de limite; abaixo de 2 GB há risco de OOM com Chromium e as CLIs dos agentes) e
40 GB+ de disco.

Opções (confira o preço atual antes de contratar; não contratei nada):

| Opção | Observação |
| --- | --- |
| VPS x86 de 4 GB (Hetzner, Contabo, DigitalOcean, Vultr...) | Usa a imagem `amd64` deste projeto sem mudanças |
| Oracle Cloud "Always Free" Ampere (ARM) | Gratuita se houver capacidade; precisa da imagem `arm64` (trocar o `FROM` pelo digest arm64 e o Node por multi-arch) |
| Servidor hospedado da própria Nightly Labs (`docs/hosted-servers.md`) | Gerenciado e sem Docker, mas sem este gateway (usa só `openbot.run/app`) |

Passo a passo em `vps/compose.yaml`: mesma imagem e mesmo gateway (interface de admin com e-mail e senha + MCP/REST
para outro chat), com `seccomp.json` oficial, `shm_size: 1g` e Caddy para HTTPS automático.

Endurecimento mínimo do VPS: só as portas 22, 80 e 443 abertas (ufw), SSH apenas por chave, atualizações
automáticas (`unattended-upgrades`), backup do volume `openbot-data` com o container parado.

## 7. Arquitetura equivalente mantendo a Vertra

```
Vertra Cloud (inalterada)                      VPS Linux (Docker)
  agencia-web, agencia-worker, wa-gateway,       openbot (imagem oficial 0.72.0 + gateway)
  revela-face-engine, agencia-db                   ├─ seccomp oficial, /dev/shm 1 GiB, volume /app
                                                   └─ Caddy :443 → gateway :8080 (admin + /mcp + /api/v1)
              ▲                                              ▲
              └── os agentes acessam as apps Vertra pela     └── openbot.run/app e celular (WebRTC, saída)
                  internet / MCP Vertra (chave própria,          outro chat → https://<domínio>/mcp (token)
                  escopos mínimos)
```

A Vertra continua hospedando as aplicações. Os agentes do OpenBot podem operá-las pelo MCP oficial da Vertra,
com uma chave separada e escopos mínimos, configurada no servidor OpenBot.

## Limpeza recomendada na Vertra (ação do usuário)

- Excluir a app `openbot-vertra-hml` (`11e7b75e-...`, parada) para liberar 1536 MB do plano.
- Opcional: excluir a imagem `openbot-vertra` (`62332720-...`) para liberar 1 dos 2 slots de imagem. Mantenha-a se
  for esperar a resposta do suporte.
- A chave de API usada tem escopos de escrita. Se não houver próximo passo na Vertra, revogue-a no painel.
