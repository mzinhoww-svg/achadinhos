import { criarDb, migrar, PASTA_MIGRACOES } from "@achadinhos/db";
import Fastify from "fastify";
import pg from "pg";
import { PgBoss } from "pg-boss";
import { criarApp, VERSAO } from "./app.js";
import { ArmazenamentoBanco, VertraBlob } from "./arte/armazenamento.js";
import { Alertas } from "./ciclo/controle.js";
import type { DepsCiclo } from "./ciclo/disparo.js";
import { Gateway } from "./ciclo/gateway.js";
import { agendarCiclo } from "./ciclo/job.js";
import { agendarMonitor } from "./coleta/job.js";
import { criarMarketplaces } from "./coleta/marketplaces.js";
import { REGRAS_PADRAO, type RegrasOferta } from "./coleta/regras.js";
import { type Config, lerConfig, opcoesSsl, urlSemSsl } from "./config.js";
import { OuvinteEventos } from "./ouvinte.js";
import { agendarReels } from "./reels/job.js";
import type { DepsReels } from "./reels/servico.js";
import { semearAdmin } from "./seed.js";

const porta = Number(process.env.PORT || 80);
const host = process.env.HOST || "0.0.0.0";

let config: Config;
try {
  config = lerConfig();
} catch (e) {
  // Sem variáveis (ex.: logo depois do deploy): sobe mesmo assim e diz o que falta, sem crash loop.
  const motivo = e instanceof Error ? e.message : String(e);
  const degradado = Fastify({ logger: true });
  // /health responde 200 com ok:false: a borda da Vertra troca respostas 5xx pela página de erro dela.
  degradado.all("/*", async (req, reply) =>
    reply
      .code(req.url.split("?")[0] === "/health" ? 200 : 503)
      .send({ ok: false, versao: VERSAO, erro: "configuracao_incompleta", mensagem: motivo }),
  );
  degradado.log.error(motivo);
  await degradado.listen({ port: porta, host });
  await new Promise(() => {}); // fica no ar até a Vertra reiniciar com as variáveis
  throw new Error("inalcançável");
}

const ssl = opcoesSsl(config);
const conexao = { connectionString: urlSemSsl(config.DATABASE_URL), ssl };
const pool = new pg.Pool({ ...conexao, max: 10, application_name: "achadinhos-worker" });
pool.on("error", (e) => app.log.error({ err: e }, "erro numa conexão ociosa do pool"));
const db = criarDb(pool);

// No deploy, as migrações ficam em ./drizzle ao lado do worker.mjs; no desenvolvimento, no pacote db.
const pastaMigracoes =
  config.MIGRACOES_DIR ??
  (import.meta.url.endsWith("/worker.mjs")
    ? new URL("./drizzle", import.meta.url).pathname
    : PASTA_MIGRACOES);

const ouvinte = new OuvinteEventos(conexao, {
  info: (o, m) => app.log.info(o, m),
  warn: (o, m) => app.log.warn(o, m),
});
// Fila no próprio Postgres, num schema separado.
const boss = new PgBoss({ ...conexao, schema: "achadinhos_fila", application_name: "achadinhos-fila" });

const estado = { pronto: false, fila: false, erro: null as string | null };
const marketplaces = criarMarketplaces(db, config);
const regras: RegrasOferta = {
  ...REGRAS_PADRAO,
  minAmostras: config.HISTORICO_MIN_AMOSTRAS,
  minDias: config.HISTORICO_MIN_DIAS,
};
const armazenamento = config.VERTRA_BLOB_KEY
  ? new VertraBlob(config.VERTRA_BLOB_KEY, config.VERTRA_BLOB_URL, config.VERTRA_BLOB_PREFIXO)
  : new ArmazenamentoBanco(db);
const gateway =
  config.WA_GATEWAY_URL && config.WA_GATEWAY_TOKEN
    ? new Gateway(config.WA_GATEWAY_URL, config.WA_GATEWAY_TOKEN, config.WA_GATEWAY_POOL)
    : null;
const ciclo: DepsCiclo = {
  db,
  gateway,
  alertas: new Alertas(db, gateway),
  marketplace: marketplaces.principal,
  painelUrl: config.PAINEL_PUBLIC_URL,
  arte: {
    armazenamento,
    baseUrl: config.WORKER_PUBLIC_URL ?? "https://achadinhos-worker.vertraweb.app",
    limiarConfianca: config.ARTE_LIMIAR_CONFIANCA,
  },
  openrouterKey: config.OPENROUTER_API_KEY,
  openrouterBaseUrl: config.OPENROUTER_BASE_URL,
};
const reels: DepsReels = {
  db,
  marketplace: marketplaces.principal,
  armazenamento,
  baseUrl: config.WORKER_PUBLIC_URL ?? "https://achadinhos-worker.vertraweb.app",
  painelUrl: config.PAINEL_PUBLIC_URL,
};
const app = criarApp({
  db,
  serviceToken: config.SERVICE_TOKEN,
  ouvinte,
  logLevel: config.LOG_LEVEL,
  estado: () => ({ fila: estado.fila, listen: ouvinte.conectado, pronto: estado.pronto, erro: estado.erro }),
  marketplaces,
  regras,
  arte: {
    armazenamento,
    limiarConfianca: config.ARTE_LIMIAR_CONFIANCA,
    publicUrl: config.WORKER_PUBLIC_URL,
  },
  ciclo: { deps: ciclo, webhookToken: config.WA_WEBHOOK_TOKEN },
  reels,
});

/** Migrações, admin inicial, LISTEN e fila. Se o banco falhar, tenta de novo sem derrubar o processo. */
async function prepararBanco(tentativa = 1): Promise<void> {
  try {
    app.log.info({ pastaMigracoes }, "aplicando migrações");
    await migrar(db, pastaMigracoes);
    await semearAdmin(db, config, { info: (m) => app.log.info(m), warn: (m) => app.log.warn(m) });
    await ouvinte.iniciar();
    boss.on("error", (e) => app.log.error({ err: e }, "pg-boss"));
    await boss.start();
    await agendarMonitor(boss, db, marketplaces, {
      cron: config.MONITOR_CRON,
      maxDetalhes: config.MONITOR_MAX_DETALHES,
      regras,
      log: { info: (o, m) => app.log.info(o, m), warn: (o, m) => app.log.warn(o, m) },
    });
    await agendarCiclo(boss, ciclo, {
      cronDisparo: config.DISPARO_CRON,
      modo: config.CICLO_AUTOMATICO,
      log: { info: (m) => app.log.info(m), warn: (o, m) => app.log.warn(o, m) },
    });
    await agendarReels(boss, reels, { warn: (o, m) => app.log.warn(o, m) });
    if (!gateway)
      app.log.warn("WA_GATEWAY_URL/WA_GATEWAY_TOKEN ausentes: disparo e alertas no WhatsApp desligados");
    if (marketplaces.indisponivel) app.log.warn(marketplaces.indisponivel);
    estado.fila = true;
    estado.pronto = true;
    estado.erro = null;
    app.log.info("worker pronto");
  } catch (e) {
    // O drizzle embrulha o erro do driver ("Failed query"); a causa diz o que houve (ex.: ECONNREFUSED).
    const causa = e instanceof Error && e.cause instanceof Error ? e.cause : e;
    estado.erro = `banco: ${causa instanceof Error ? causa.message : String(causa)}`;
    const espera = Math.min(15_000 * tentativa, 120_000);
    app.log.error({ err: e, esperaMs: espera }, "banco indisponível; nova tentativa em breve");
    setTimeout(() => void prepararBanco(tentativa + 1), espera).unref();
  }
}

let encerrando = false;
async function encerrar(sinal: string) {
  if (encerrando) return;
  encerrando = true;
  app.log.info({ sinal }, "encerrando");
  await app.close().catch(() => {});
  await boss.stop({ graceful: true, timeout: 10_000 }).catch(() => {});
  await ouvinte.parar();
  await pool.end().catch(() => {});
  process.exit(0);
}
process.on("SIGTERM", () => void encerrar("SIGTERM"));
process.on("SIGINT", () => void encerrar("SIGINT"));

await app.listen({ port: config.PORT, host: config.HOST });
void prepararBanco();
