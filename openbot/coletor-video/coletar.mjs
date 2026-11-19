// Coletor de vídeo do Achadinhos (roda no Mac do Aurimar).
// 1. Pega no worker os Reels que esperam vídeo (GET /reels/pendentes-video).
// 2. Abre cada produto no Chrome (perfil próprio do coletor, logado na Shopee uma única vez).
// 3. Lê o vídeo oficial do produto na resposta da página e baixa.
// 4. Envia ao worker (POST /reels/:id/video). Sem vídeo, pede o Reel das fotos (POST /reels/:id/fotos).
//
// Uso:  ACHADINHOS_MCP_DIRETOR_DE_VIDEO="<token do Diretor de Vídeo>" node coletar.mjs [--limite 40] [--visivel]
// O token fica no cofre do OpenBot; nunca escreva o token neste arquivo.
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const WORKER = process.env.ACHADINHOS_WORKER ?? "https://achadinhos-worker.vertraweb.app";
const bruto = process.env.ACHADINHOS_MCP_DIRETOR_DE_VIDEO ?? process.env.ACHADINHOS_TOKEN ?? "";
const token = bruto.replace(/^Bearer\s+/i, "").trim();
if (!/^ach_[0-9a-f]{40}$/.test(token)) {
  console.error("Defina ACHADINHOS_MCP_DIRETOR_DE_VIDEO com o token do Diretor de Vídeo (cofre do OpenBot).");
  process.exit(1);
}
const args = process.argv.slice(2);
const limite = Number(args[args.indexOf("--limite") + 1]) || 40;
const visivel = args.includes("--visivel");
const AUTH = { authorization: `Bearer ${token}` };
const PERFIL = process.env.COLETOR_PERFIL ?? join(dirname(fileURLToPath(import.meta.url)), ".perfil-chrome");
mkdirSync(PERFIL, { recursive: true });

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/** Procura URLs de vídeo em qualquer JSON da página (video_info_list, default_format, formats...). */
function acharVideos(obj, achados = new Set(), prof = 0) {
  if (!obj || prof > 12) return achados;
  if (typeof obj === "string") {
    if (/^https?:\/\/[^\s"]+\.(mp4|m3u8)(\?|$)/i.test(obj) || /vod\.susercontent\.com|cvf\.shopee/i.test(obj)) achados.add(obj);
    return achados;
  }
  if (Array.isArray(obj)) {
    for (const x of obj) acharVideos(x, achados, prof + 1);
    return achados;
  }
  if (typeof obj === "object") for (const v of Object.values(obj)) acharVideos(v, achados, prof + 1);
  return achados;
}

async function api(caminho, init = {}) {
  const r = await fetch(`${WORKER}${caminho}`, { ...init, headers: { ...AUTH, ...(init.headers ?? {}) } });
  const corpo = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${caminho}: HTTP ${r.status} ${corpo.mensagem ?? corpo.erro ?? ""}`);
  return corpo;
}

const { pendentes } = await api(`/reels/pendentes-video?limite=${limite}`);
console.log(`${pendentes.length} Reels esperando vídeo.`);
if (!pendentes.length) process.exit(0);

const ctx = await chromium.launchPersistentContext(PERFIL, {
  channel: "chrome",
  headless: !visivel,
  viewport: { width: 1280, height: 900 },
  locale: "pt-BR",
});
const resumo = { video: 0, fotos: 0, erro: 0 };
try {
  for (const p of pendentes) {
    const page = await ctx.newPage();
    const candidatos = new Set();
    page.on("response", async (res) => {
      try {
        const url = res.url();
        const tipo = res.headers()["content-type"] ?? "";
        if (tipo.startsWith("video/mp4")) candidatos.add(url);
        else if (/\/api\/v4\/(pdp\/get_pc|pdp\/get|item\/get)/.test(url) && tipo.includes("json")) acharVideos(await res.json(), candidatos);
      } catch {
        /* resposta já descartada */
      }
    });
    try {
      await page.goto(p.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      for (let i = 0; i < 24 && !candidatos.size; i++) await esperar(500);
      if (!candidatos.size) {
        const src = await page.evaluate(() => document.querySelector("video")?.currentSrc || "").catch(() => "");
        if (src && !src.startsWith("blob:")) candidatos.add(src);
      }
      const url = [...candidatos].find((u) => /\.mp4/i.test(u)) ?? [...candidatos][0];
      if (url && !/\.m3u8/i.test(url)) {
        const r = await ctx.request.get(url, { timeout: 60_000 });
        const video = await r.body();
        if (!r.ok() || video.length < 20_000 || video.length > 80 * 1024 * 1024) throw new Error(`vídeo inválido (${r.status()}, ${video.length} bytes)`);
        await api(`/reels/${p.id}/video`, { method: "POST", headers: { "content-type": "video/mp4" }, body: video });
        resumo.video++;
        console.log(`✓ ${p.palavra}: vídeo enviado (${(video.length / 1048576).toFixed(1)} MB)`);
      } else {
        await api(`/reels/${p.id}/fotos`, { method: "POST" });
        resumo.fotos++;
        console.log(`• ${p.palavra}: sem vídeo na página, Reel feito com as fotos`);
      }
    } catch (e) {
      resumo.erro++;
      console.log(`✗ ${p.palavra}: ${e.message}`);
    } finally {
      await page.close();
    }
    // ritmo humano entre produtos
    await esperar(8_000 + Math.random() * 7_000);
  }
} finally {
  await ctx.close();
}
console.log(JSON.stringify({ resumo }));
