# Guia rápido: `pnpm outbox:gerar`

Guia curto de uso do gerador de ofertas (T7-B). Ele busca ofertas, gera o link curto, monta o
criativo e **grava arquivos numa pasta local** — sem banco, sem Telegram e sem e-mail. A pasta é o
único resultado; nada fica guardado em outro lugar.

## Antes de rodar

```sh
export SHOPEE_APP_ID=...
export SHOPEE_SECRET=...
export SHOPEE_ENDPOINT=http://127.0.0.1:PORT/graphql   # servidor simulado
export AFFILIATE_HANDLE=@seu_handle
```

Por segurança, o CLI **só aceita endpoint de loopback** (`127.0.0.1`, `localhost`, `::1`). Endpoint
fora disso é recusado (exit 2). `--permitir-real` libera um endpoint real, mas **só use com
autorização de Aurimar e depois de a credencial passar no item 2 do checklist** — hoje o
`productOfferV2` ainda responde 10010.

## Rodar

```sh
pnpm outbox:gerar -- --limite 10 --outbox outbox
```

- `--limite N`: quantas ofertas no máximo por execução (padrão 10, máximo 50).
- `--outbox DIR`: onde gravar (padrão `OUTBOX_DIR` ou `./outbox`).
- `--grupo LABEL` e `--grupo-indice N`: rótulo e posição do grupo (1..99, entra no nome do arquivo).
- `--keyword TXT`: filtro de busca.

`--help` mostra todas as flags.

## Onde saem os arquivos

Tudo fica em `outbox/<AAAAMMDD>/`, sendo o dia no fuso **America/Cuiaba**, calculado uma vez no
início da execução:

```
outbox/
  20261016/
    index.md                     tabela do dia (índice)
    1432-123456789-g1.md         <HHMM>-<itemId>-g<grupo>
    1432-123456789-g1.png        criativo ao lado
```

Cada oferta entregue gera **um `.md` + um `.png`**. O `.md` é o marcador de "entregue": se ele já
existe, a reexecução não mexe em nada (idempotência). O `.png` pode ficar órfão se algo falhar entre
os dois; ele é inofensivo.

## Como ver o índice do dia

O `index.md` da pasta do dia lista as entregas (hora, item, grupo e título):

```sh
cat outbox/20261016/index.md          # o índice do dia
ls -1  outbox/20261016/               # os arquivos do dia
```

O índice é **derivado**: ele é reconstruído listando a pasta, então sempre reflete os `.md` ali
presentes. Para abrir o mais recente sem decorar a data:

```sh
ls -1dt outbox/*/ | head -1            # pasta do dia mais recente
cat "$(ls -1dt outbox/*/ | head -1)index.md"
```

## Ler uma entrega

Cada `.md` tem um front matter JSON (dados: slot, itemId, título, link, preços, desconto, data) e um
corpo com o título, o link curto, o preço e a mensagem pronta para copiar (em bloco de código). O
`.png` ao lado é o criativo 1080x1080.

## Status e código de saída

- Por oferta, o terminal mostra o `slotKey` e `delivered`/`failed`/`unknown` (+ um código fixo,
  quando não entregue). O resumo traz totais e quantas ofertas foram descartadas.
- **Exit code ≠ 0** se alguma oferta falhar ou se a busca falhar inteira — útil para automatizar.

## Notas

- O recurso vem do T7-B (`apps/worker/src/gerar/`); este guia acompanha esse PR.
- Segredos ficam só em `.env`/ambiente; nunca aparecem em log nem nos arquivos da outbox.
- `outbox/` é gitignored.
