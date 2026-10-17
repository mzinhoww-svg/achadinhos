# Gerador da outbox (T7-B)

CLI `pnpm outbox:gerar`: busca ofertas (`productOfferV2`), filtra, deduplica **só dentro do lote**,
gera o link curto com subIds, baixa a imagem (downloader seguro), renderiza o criativo PNG e entrega
pelo canal **FileOutbox** (`@achadinhos/channel`). Sem banco, sem Telegram, sem e-mail e sem retry.

## Segurança

- **Por padrão, só endpoint de loopback** (`127.0.0.1`, `localhost`, `::1`). Endpoint fora de loopback
  é **recusado localmente** (exit 2, sem montar adaptadores nem chamar a Shopee), a menos que
  `--permitir-real` seja passado **explicitamente nesta invocação**.
- **`--permitir-real` exige `--limite N` explícito** e imprime `chamadas_max = paginas_max + limite`
  antes de começar (`paginas_max = 1` nesse modo). Use **somente** com autorização de Aurimar e
  **depois** de o item 2 do checklist validar a credencial — hoje o `productOfferV2` ainda dá 10010.
- Segredos (`SHOPEE_APP_ID`, `SHOPEE_SECRET`) ficam só em `.env`/ambiente, nunca em log, PR ou
  arquivo gerado; o logger redige o Secret.
- `outbox/` é gitignored.

## Uso

```sh
export SHOPEE_APP_ID=...
export SHOPEE_SECRET=...
export SHOPEE_ENDPOINT=http://127.0.0.1:PORT/graphql   # servidor simulado
export AFFILIATE_HANDLE=@seu_handle

pnpm outbox:gerar -- --limite 10 --outbox outbox --grupo "Grupo 1" --grupo-indice 1
```

Flags:

| Flag | Descrição |
|---|---|
| `--limite N` | teto por execução (padrão 10, máximo 50) |
| `--outbox DIR` | raiz da outbox (padrão `OUTBOX_DIR` ou `./outbox`) |
| `--grupo LABEL` | rótulo de exibição do grupo |
| `--grupo-indice N` | posição do grupo na configuração, 1..99 (vai no nome do arquivo como `-gN`) |
| `--keyword TXT` | filtro de palavra-chave da busca |
| `--handle @x` | @ do afiliado (padrão `AFFILIATE_HANDLE`) |
| `--endpoint URL` | endpoint GraphQL (padrão `SHOPEE_ENDPOINT`) |
| `--permitir-real` | autoriza endpoint fora de loopback (exige `--limite`); só com autorização de Aurimar |

Ambiente: `SHOPEE_ENDPOINT`, `SHOPEE_APP_ID`, `SHOPEE_SECRET`, `AFFILIATE_HANDLE`,
`IMAGE_ALLOWED_HOSTS` (allowlist do download), `OUTBOX_DIR`, `OUTBOX_LIMIT`, `OUTBOX_ACCOUNT`,
`OUTBOX_AUTOMATION`, `OUTBOX_GROUP_SUBID`, `LOG_LEVEL`.

## Saída

- Por oferta: `slotKey` e `delivered|failed|unknown` (+ código fixo); nada de mensagem de erro.
- Resumo no fim (inclui `descartadas`); **exit code ≠ 0** se alguma oferta falhar (ou se a busca falhar
  inteira). No modo local a busca pode paginar até 10 vezes (`productOfferV2`); com `--permitir-real`
  é 1 página.
- Arquivos: `outbox/<AAAAMMDD>/<HHMM>-<itemId>-g<indice>.md` e `.png`, mais o `index.md` do dia.
  O `.md` é o único marcador de "entregue".

## Servidor simulado

Enquanto a credencial real não é validada, use o servidor da própria stack:
`startMockShopeeServer()` de `@achadinhos/shopee/testing`, ou qualquer GraphQL local que assine igual
ao `ShopeeClient`. Os testes e2e de `apps/worker/tests/gerar/` usam um servidor local configurável
(N ofertas → N pares `.md`/`.png` + índice).
