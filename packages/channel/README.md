# @achadinhos/channel

Interface `Channel` + adaptador `FileOutbox` (plano `docs/plans/escopo-sem-supabase-telegram.md` §1).

- Não depende de Shopee, Telegram, Supabase ou banco.
- O canal **não calcula tempo**: recebe o `Slot` (`day`/`hhmm`/`groupIndex`) pronto do gerador (T7-B).
- `FileOutbox` grava `outbox/<day>/<hhmm>-<itemId>-g<groupIndex>.{png,md}` e um `index.md` derivado.
  O `.md` é o único marcador de "entregue"; o `.png` vem antes e pode ficar órfão.

```ts
import { createFileOutbox } from "@achadinhos/channel";

const channel = createFileOutbox({ dir: "outbox" }); // ou OUTBOX_DIR
const result = await channel.deliver(offer, { signal });
// { status: "delivered" | "failed" | "unknown", ... }
```

Regras hostis cobertas por testes em `src/__tests__/`:
nome de arquivo só com campos controlados; pasta `0700`, arquivos `0600`; symlink recusado;
`.md` publicado por `link` (não sobrescreve); título/texto/URL neutralizados; números finitos ≥ 0;
PNG com assinatura e ≤ `MAX_CREATIVE_PNG_BYTES`; sem segredo na outbox.
