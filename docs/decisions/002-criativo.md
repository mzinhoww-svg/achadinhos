# 002 — Geração do criativo
Status: aceita (pendente de parecer do Designer)
## Opções
1. **Satori + Resvg (JSX→SVG→PNG)**: layout declarativo, determinístico, snapshot testável, sem binário nativo de navegador (Resvg usa WASM/napi), fontes embutidas.
2. **sharp + SVG manual**: rápido, mas layout e quebra de texto manuais, difícil de manter.
3. Headless browser (Playwright): pesado e fora do escopo ("sem navegador automatizado").
## Decisão
Opção 1. Fontes incluídas no repo (licença livre), imagem do produto baixada com limite de tamanho/tipo/timeout, snapshot PNG por fixture.

## Parecer do Planejador (Farol) — 2026-10-13 (risco e segurança; o parecer visual segue com o Designer)
**Veredito: ACEITA COM AJUSTES.** Satori + Resvg é a melhor opção (determinística, testável, sem navegador). Ajustes:
- **C1 — Download da imagem é a superfície de ataque (SSRF e DoS).** Só `https`; host na allowlist do CDN da Shopee (lista fixada em config, confirmada na doc/respostas reais); resolver DNS e bloquear IP privado/loopback/link-local; sem redirect para fora da allowlist; limite de bytes (ex.: 5 MB) e timeout (ex.: 10 s); validar `content-type` e magic bytes (jpeg/png/webp); limitar dimensão em pixels antes de decodificar (bomba de descompressão).
- **C2 — Texto da oferta é dado não confiável.** Título/loja entram só como texto no JSX (nunca HTML/SVG bruto); truncar por largura, tratar emoji/RTL/caracteres sem glifo com fonte de fallback; testar título de 300 caracteres e título vazio.
- **C3 — Escolher um runtime do Resvg.** `@resvg/resvg-js` (napi, binário por plataforma; ok em linux-x64 do VPS) ou `@resvg/resvg-wasm`. Fixar versão exata de satori, resvg e fontes no lockfile; snapshot comparado por tolerância de pixel para não quebrar com patch de dependência.
- **C4 — Roda no worker, dentro do lease** (A4 da decisão 001), com timeout próprio de render (ex.: 15 s). Erro de render = `failed` com motivo, sem retry.
- **C5 — Armazenamento.** `creative_url` aponta para bucket privado do Supabase com URL assinada de vida curta, ou o PNG vai direto ao Telegram sem persistir. Não usar bucket público (o criativo carrega link com subIds do afiliado). Caption do Telegram tem limite de 1024 caracteres: `message_text` truncado no worker.
