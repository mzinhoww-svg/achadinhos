import { criarDb, migrar, PASTA_MIGRACOES } from "@achadinhos/db";
import pg from "pg";
import { PgBoss } from "pg-boss";
import { criarApp } from "./app.js";
import { lerConfig, opcoesSsl } from "./config.js";
import { OuvinteEventos } from "./ouvinte.js";
import { semearAdmin } from "./seed.js";

const config = lerConfig();
const ssl = opcoesSsl(config);
const conexao = { connectionString: config.DATABASE_URL, ssl };

const pool = new pg.Pool({ ...conexao, max: 10, application_name: "achadinhos-worker" });
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
const boss = new PgBoss({
  connectionString: config.DATABASE_URL,
  ssl,
  schema: "achadinhos_fila",
  application_name: "achadinhos-fila",
});
let filaOk = false;

const app = criarApp({
  db,
  serviceToken: config.SERVICE_TOKEN,
  ouvinte,
  logLevel: config.LOG_LEVEL,
  estado: () => ({ fila: filaOk, listen: ouvinte.conectado }),
});

async function iniciar() {
  app.log.info({ pastaMigracoes }, "aplicando migrações");
  await migrar(db, pastaMigracoes);
  await semearAdmin(db, config, { info: (m) => app.log.info(m), warn: (m) => app.log.warn(m) });
  await ouvinte.iniciar();
  boss.on("error", (e) => app.log.error({ err: e }, "pg-boss"));
  await boss.start();
  filaOk = true;
  await app.listen({ port: config.PORT, host: config.HOST });
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

iniciar().catch((e) => {
  app.log.fatal({ err: e }, "falha ao iniciar o worker");
  process.exit(1);
});
