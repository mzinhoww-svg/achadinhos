# Coletor de vídeo (Mac)

Baixa o vídeo oficial da página de cada produto na Shopee e entrega ao worker, que monta o Reel (gancho, preço e
"Comente PALAVRA"). Produto sem vídeo vira Reel das fotos. Roda no Mac porque a Shopee bloqueia esse acesso vindo
de servidores.

> Aviso: abrir páginas da Shopee de forma automatizada vai contra os termos de uso dela. Decisão do Aurimar
> (19/11/2026), ciente do risco para a conta de afiliado. O coletor vai devagar (8 a 15 s entre produtos) e usa
> um perfil próprio do Chrome.

## Uma vez só

```bash
cd openbot/coletor-video
npm install
node coletar.mjs --visivel --limite 1   # abre o Chrome: entre na Shopee com a sua conta e feche
```

O login fica salvo em `openbot/coletor-video/.perfil-chrome` (fora do git).

## Todo dia (o Diretor de Vídeo roda)

```bash
ACHADINHOS_MCP_DIRETOR_DE_VIDEO="<valor do cofre>" node openbot/coletor-video/coletar.mjs --limite 40
```

O token é o do Diretor de Vídeo (tela Agentes do painel); o OpenBot injeta a partir do cofre.
