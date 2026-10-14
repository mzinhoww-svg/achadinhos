# Design system — achadinhos (T3)

Identidade própria, base clara, sem semelhança com achadinhos.doti.gg.

## Tokens (`apps/web/src/app/globals.css`, espelhados em `packages/creative/src/tokens.ts`)
| Papel | Valor | Uso |
|---|---|---|
| bg | `#ffffff` | superfície principal |
| sunken / sunken-2 | `#f9f4f7` / `#f3ecf0` | sidebar, cabeçalhos de tabela, estados vazios |
| line / line-strong | `#e8e0e5` / `#d2c7ce` | bordas e controles |
| ink / ink-2 / ink-3 | `#1c1319` / `#574851` / `#6c5f67` | texto (todos ≥ 4,5:1 sobre branco) |
| brand 50/100/500/600/700 | `#ffecfa` … `#a61b86` `#8d1071` `#71115b` | ameixa: ação primária, seleção, preço |
| sun | `#f7d22a` (tinta `#724e00`) | selo de desconto, avisos |
| ok / err / info / teal | `#00713e` `#b71824` `#2266a4` `#00756b` | estados |

Tipografia: **Bricolage Grotesque** (700/800, só títulos e números) + **Figtree** (400–700, interface). Fontes OFL, self-hosted (`@fontsource`; cópias `.woff` em `packages/creative/fonts` para o Satori).
Raios 10/14 px, sombra só em elevação real, movimento 150 ms e `prefers-reduced-motion` respeitado.

## Componentes (`apps/web/src/components/ui`)
`Button` (primary/secondary/ghost/danger, loading, disabled) · `Card` · `DataTable` (tabela ≥ md, lista de cartões < md) · `Badge`/`StatusBadge` (sempre com rótulo) · `EmptyState` · `Field`/`Input`/`Select`/`Textarea`/`Switch`/`Chip` · `PageHeader`.

## Estados vazios
Toda tela aceita `?vazio=1` (ou o atalho “Ver estados vazios” na navegação). Dados vêm de `src/lib/mock.ts`.

## Criativo 1080×1080 (`packages/creative`)
`<Creative />` usa só flexbox e estilos inline (Satori). `renderCreativePng()` gera o PNG; `pnpm --filter @achadinhos/creative sample` grava `out/sample.png`. Exemplo: `docs/design/creative-sample.png`.

## QA visual
`docs/design/screenshots/*-390.png` (390×844) e `*-1440.png` (1440×900), com dados e com `?vazio=1`.
