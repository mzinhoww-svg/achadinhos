# 002 — Geração do criativo
Status: aceita (pendente de parecer do Designer)
## Opções
1. **Satori + Resvg (JSX→SVG→PNG)**: layout declarativo, determinístico, snapshot testável, sem binário nativo de navegador (Resvg usa WASM/napi), fontes embutidas.
2. **sharp + SVG manual**: rápido, mas layout e quebra de texto manuais, difícil de manter.
3. Headless browser (Playwright): pesado e fora do escopo ("sem navegador automatizado").
## Decisão
Opção 1. Fontes incluídas no repo (licença livre), imagem do produto baixada com limite de tamanho/tipo/timeout, snapshot PNG por fixture.
