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

## Automações por arquivo (T7-D)

Em vez de rodar uma oferta só, dá para descrever até **5 automações** num arquivo JSON só-leitura,
editado à mão (sem segredo): `config/automacoes.json`.

```json
{
  "automacoes": [
    {
      "name": "Promoções do dia",
      "filters": { "minDiscount": 20, "sort": "discount_desc" },
      "days": [1, 2, 3, 4, 5],
      "windowStart": "08:00",
      "windowEnd": "22:00",
      "frequencyMin": 30,
      "timeZone": "America/Cuiaba"
    }
  ]
}
```

```sh
pnpm outbox:gerar -- --automacoes config/automacoes.json
# opcional: rodar como se fosse um instante específico
pnpm outbox:gerar -- --automacoes config/automacoes.json --agora 2026-10-16T18:32:00Z
```

- Cada automação vira uma busca com os **filtros** dela; a `--limite` vale **por automação** — no
  pior caso (5 automações) são até 5 × 50 = 250 ofertas por execução.
- **Palavra-chave**: só a **primeira** de `filters.keywords|keyword|search|q` vai para a busca da
  Shopee (que aceita uma string); as demais continuam valendo no filtro local.
- `groupIndex` no nome do arquivo é a posição da automação no arquivo (1..5), estável mesmo com
  automações não vencidas intercaladas.
- **Agendamento sem estado**: roda só as automações cuja janela/dias contêm o instante da execução
  (a janela usa o `timeZone` da automação; a **pasta do dia** é sempre America/Cuiaba, pela regra do
  `Slot`). Frequência/antirrepetição dependem de persistência e seguem adiadas (§4): **não** ponha
  isto num cron de minuto — cada execução dentro da janela gera slots novos.
- `header`, `footer` e `groups` são aceitos no arquivo e **ignorados** hoje (reservados). Chaves
  desconhecidas de `filters` passam em silêncio (um typo como `minDiscountt` não avisa).
- **Falha fechado**: arquivo ausente, JSON inválido, automação inválida ou **6ª automação** →
  exit 2 com código fixo (`automacoes_ausentes`/`automacoes_invalidas`/`automacoes_limite`). Falha da
  busca em qualquer automação sai com **exit ≠ 0**.
- Com `--permitir-real`, `chamadas_max = vencidas × (páginas + limite)` é impresso **antes** de
  qualquer chamada (e `0` quando nenhuma vence).

## Servidor simulado

Enquanto a credencial real não é validada, use o servidor da própria stack:
`startMockShopeeServer()` de `@achadinhos/shopee/testing`, ou qualquer GraphQL local que assine igual
ao `ShopeeClient`. Os testes e2e de `apps/worker/tests/gerar/` usam um servidor local configurável
(N ofertas → N pares `.md`/`.png` + índice).
