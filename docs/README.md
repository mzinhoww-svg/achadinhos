# Achadinhos · documentação

Ofertas reais da Shopee, com a foto real do produto, enviadas sozinhas em grupos de WhatsApp por uma equipe de
agentes de IA, com painel, travas e conversões medidas.

| Documento                                      | Para quê                                                                                           |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| [OPERACAO.md](OPERACAO.md)                     | Manual do dia a dia: o que olhar, como pausar, o que fazer quando algo dá errado. **Comece aqui.** |
| [ARQUITETURA.md](ARQUITETURA.md)               | As peças (painel, worker, wa-gateway, OpenBot, banco) e como o ciclo de uma oferta passa por elas. |
| [WORKER-API.md](WORKER-API.md)                 | Todas as rotas do worker, quem chama e o que fazem.                                                |
| [DEPLOY.md](DEPLOY.md)                         | Como publicar na Vertra e quais variáveis cada app usa.                                            |
| [PAINEL.md](PAINEL.md)                         | O desenho do painel aprovado no Prompt 1.                                                          |
| [DECISOES.md](DECISOES.md)                     | Por que cada coisa foi feita do jeito que está (D-001 em diante).                                  |
| [BRIEF.md](BRIEF.md)                           | O pedido original e o perfil do projeto.                                                           |
| [PROMPTS.md](PROMPTS.md)                       | O roteiro dos 8 prompts do piloto.                                                                 |
| [../openbot/RECRIAR.md](../openbot/RECRIAR.md) | Como montar a equipe de agentes no OpenBot do zero.                                                |

## Endereços

- Painel: https://achadinhos-painel.vertraweb.app
- Worker: https://achadinhos-worker.vertraweb.app (`/health` mostra se está tudo de pé)
- wa-gateway: https://wa-gateway-revela.vertraweb.app (compartilhado com o Revela; o Achadinhos usa o pool `achadinhos`)
- Código: `mzinhoww-svg/achadinhos` (monorepo) e `mzinhoww-svg/wa-gateway`

## Rodar localmente

```bash
pnpm install
service postgresql start            # Postgres local para os testes
DATABASE_URL_TESTE=postgres://teste:teste@127.0.0.1:5432/achadinhos_teste pnpm test
pnpm lint && pnpm typecheck
pnpm empacotar                      # gera deploy/worker e deploy/painel
```
