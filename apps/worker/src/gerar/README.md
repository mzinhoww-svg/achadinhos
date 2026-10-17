# Gerador da outbox (T7-B)

CLI `pnpm outbox:gerar`: busca ofertas (`productOfferV2`), filtra, deduplica **só dentro do lote**,
gera o link curto com subIds, baixa a imagem (downloader seguro), renderiza o criativo PNG e entrega
pelo canal **FileOutbox** (`@achadinhos/channel`). Sem banco, sem Telegram, sem e-mail e sem retry.

## Segurança

- **Nenhuma chamada real à Shopee sem `SHOPEE_ENDPOINT` explícito**: o CLI exige a variável e falha
  fechado se ela não existir. Enquanto o 10010 estiver aberto, aponte para o servidor simulado.
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

Ambiente: `SHOPEE_ENDPOINT`, `SHOPEE_APP_ID`, `SHOPEE_SECRET`, `AFFILIATE_HANDLE`,
`IMAGE_ALLOWED_HOSTS` (allowlist do download), `OUTBOX_DIR`, `OUTBOX_LIMIT`, `OUTBOX_ACCOUNT`,
`OUTBOX_AUTOMATION`, `OUTBOX_GROUP_SUBID`, `LOG_LEVEL`.

## Saída

- Por oferta: `slotKey` e `delivered|failed|unknown` (+ código fixo); nada de mensagem de erro.
- Resumo no fim; **exit code ≠ 0** se alguma oferta falhar (ou se a busca falhar inteira).
- Arquivos: `outbox/<AAAAMMDD>/<HHMM>-<itemId>-g<indice>.md` e `.png`, mais o `index.md` do dia.
  O `.md` é o único marcador de "entregue".

## Servidor simulado

Enquanto a credencial real não é validada, use o servidor da própria stack:
`startMockShopeeServer()` de `@achadinhos/shopee/testing`, ou qualquer GraphQL local que assine igual
ao `ShopeeClient`. Os testes e2e de `apps/worker/tests/gerar/` usam um servidor local configurável
(N ofertas → N pares `.md`/`.png` + índice).
