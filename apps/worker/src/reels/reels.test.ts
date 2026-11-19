import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { criarDb, migrar, tabelas as t } from "@achadinhos/db";
import { eq, sql } from "drizzle-orm";
import pg from "pg";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarApp } from "../app.js";
import { ArmazenamentoBanco } from "../arte/armazenamento.js";
import { horarioBrt } from "../ciclo/disparo.js";
import { tokenAgente } from "../mcp/ferramentas.js";
import { cuidarDaFila, type DepsReels, escolherPalavra, horariosDoDia } from "./servico.js";

const URL_TESTE = process.env.DATABASE_URL_TESTE;
const TOKEN = "r".repeat(40);
const H = { "x-service-token": TOKEN };

describe("reels: palavra e horários", () => {
  it("palavra forte do nome, sem acento, e número quando repete", () => {
    expect(escolherPalavra("Porta Tempero Giratório com 12 Potes", new Set())).toBe("PORTA");
    expect(escolherPalavra("Luminária de mesa", new Set(["LUMINARIA"]))).toBe("LUMINARIA2");
  });
  it("40 horários entre 8h e 22h; dia já começado espalha o resto", () => {
    const h = horariosDoDia("2026-11-20", 40, horarioBrt("2026-11-20", "06:00"));
    expect(h).toHaveLength(40);
    expect(h[0]).toEqual(horarioBrt("2026-11-20", "08:00"));
    expect(h.at(-1)?.getTime()).toBeLessThan(horarioBrt("2026-11-20", "22:00").getTime());
    const tarde = horariosDoDia("2026-11-20", 10, horarioBrt("2026-11-20", "15:00"));
    expect(tarde[0]?.getTime()).toBeGreaterThan(horarioBrt("2026-11-20", "15:00").getTime());
  });
});

describe.skipIf(!URL_TESTE)("reels: fila completa", () => {
  const pool = new pg.Pool({ connectionString: URL_TESTE });
  const db = criarDb(pool);
  let foto: Buffer;
  const d: DepsReels = {
    db,
    marketplace: null,
    armazenamento: new ArmazenamentoBanco(db),
    baseUrl: "https://w.test",
    painelUrl: "https://painel.test",
    f: (async () => new Response(new Uint8Array(foto))) as unknown as typeof fetch,
  };
  const app = criarApp({
    db,
    serviceToken: TOKEN,
    logLevel: "silent",
    reels: d,
    arte: { armazenamento: d.armazenamento, limiarConfianca: 0.8, publicUrl: "https://w.test" },
  });

  beforeAll(async () => {
    foto = await sharp(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="100%" height="100%" fill="#fff"/><circle cx="400" cy="400" r="220" fill="#c33"/></svg>',
      ),
    )
      .jpeg()
      .toBuffer();
    await db.execute(sql`drop schema if exists achadinhos cascade`);
    await migrar(db);
    const [n] = await db.insert(t.nichos).values({ nome: "Casa", avaliacaoMin: "4.5" }).returning();
    for (const [i, nome] of [
      "Porta Tempero Giratório",
      "Pote Hermético de Vidro",
      "Luminária de Mesa LED",
    ].entries())
      await db.insert(t.produtos).values({
        marketplace: "shopee",
        idExterno: `${100 + i}`,
        nome,
        url: `https://shopee.com.br/p/${i}`,
        linkAfiliado: `https://s.shopee.com.br/af${i}`,
        fotoUrl: "https://down-br.img.susercontent.com/file/x",
        precoAtual: "29.90",
        avaliacao: "4.8",
        vendas: 1000 - i,
        nichoId: n?.id,
      });
    await db.insert(t.grupos).values({
      nome: "Grupo real",
      teste: false,
      ativo: true,
      linkEntrada: "https://wa.me/55659999?text=quero",
    });
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it("planeja os Reels do dia com palavra, modelo, horário, legenda e DM com link e grupo", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/reels/planejar",
      headers: H,
      payload: { quantidade: 3 },
    });
    expect(r.json()).toMatchObject({ criados: 3, avisoGrupo: null });
    const lista = (await app.inject({ url: "/reels", headers: H })).json().reels;
    expect(lista.map((x: { reel: { palavra: string } }) => x.reel.palavra)).toEqual([
      "PORTA",
      "POTE",
      "LUMINARIA",
    ]);
    expect(new Set(lista.map((x: { reel: { modelo: string } }) => x.reel.modelo)).size).toBe(3);
    const um = lista[0].reel;
    expect(um.legenda).toMatch(/Comente PORTA/);
    expect(um.legenda).not.toMatch(/abaixo do preço médio/); // sem oferta real, sem promessa de desconto
    expect(um.dmTexto).toMatch(/https:\/\/painel\.test\/r\/[A-Za-z0-9]{7}/);
    expect(um.dmTexto).toMatch(/grupo de ofertas no WhatsApp: https:\/\/wa\.me/);
    const [link] = await db.select().from(t.links).where(eq(t.links.reelId, um.id));
    expect(link).toMatchObject({
      origem: "instagram",
      ofertaId: null,
      urlAfiliado: "https://s.shopee.com.br/af0",
    });
    expect(
      (
        await app.inject({ method: "POST", url: "/reels/planejar", headers: H, payload: { quantidade: 3 } })
      ).json().criados,
    ).toBe(0);
  });

  it("o coletor do Mac lista os pendentes e envia o vídeo com o token do Diretor de Vídeo", async () => {
    const auth = { authorization: `Bearer ${tokenAgente(TOKEN, "Diretor de Vídeo")}` };
    expect((await app.inject({ url: "/reels/pendentes-video" })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          url: "/reels/pendentes-video",
          headers: { authorization: `Bearer ${tokenAgente(TOKEN, "Garimpeiro")}` },
        })
      ).statusCode,
    ).toBe(401);
    const pend = (await app.inject({ url: "/reels/pendentes-video", headers: auth })).json().pendentes;
    expect(pend).toHaveLength(3);
    const pasta = mkdtempSync(join(tmpdir(), "rv-"));
    const ff = createRequire(import.meta.url)("ffmpeg-static") as string;
    execFileSync(ff, [
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=720x720:rate=30",
      "-t",
      "6",
      "-pix_fmt",
      "yuv420p",
      join(pasta, "v.mp4"),
    ]);
    const r = await app.inject({
      method: "POST",
      url: `/reels/${pend[0].id}/video`,
      headers: { ...auth, "content-type": "video/mp4" },
      payload: readFileSync(join(pasta, "v.mp4")),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ status: "pronto", fonte: "video" });
    const mp4 = await app.inject({ url: new URL(r.json().reelUrl).pathname });
    expect(mp4.headers["content-type"]).toBe("video/mp4");
  }, 60_000);

  it("sem vídeo perto do horário, a fila faz o Reel das fotos; depois de publicado, marca o status", async () => {
    const r = await cuidarDaFila(d, horarioBrt("2026-12-31", "23:00"));
    expect(r.reserva).toBe(2);
    const prontos = (await app.inject({ url: "/reels?status=pronto", headers: H })).json().reels;
    expect(prontos).toHaveLength(3);
    expect(prontos.filter((x: { reel: { fonte: string } }) => x.reel.fonte === "fotos")).toHaveLength(2);
    const m = await app.inject({
      method: "POST",
      url: `/reels/${prontos[0].reel.id}/status`,
      headers: H,
      payload: { status: "agendado", mlabsPostId: "p1", mlabsFlowId: "f1" },
    });
    expect(m.json()).toMatchObject({ status: "agendado", mlabsFlowId: "f1" });
  }, 60_000);
});
