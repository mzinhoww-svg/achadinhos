import { createShopeeClient, type ShopeeClient } from "@achadinhos/shopee";
import { TelegramClient } from "@achadinhos/telegram";
import { createAlertService, createEmailTransportFromEnv, type EmailTransport } from "@achadinhos/alerts";
import { renderCreativePng } from "@achadinhos/creative/render";
import { ConfigError, Secret, type WorkerConfig } from "../config.js";
import { createSendExecutor, type ExecutorDeps } from "../executor.js";
import { SqlHeartbeatStore, type SqlExecutor } from "../heartbeat-store.js";
import type { Logger } from "../logger.js";
import type { BuildDeps } from "../main.js";
import { createOfferSelector } from "../offer-selection.js";
import { runSchedulerTick } from "../scheduler.js";
import type { SelectionInput } from "../scheduler-ports.js";
import { hostname } from "node:os";
import type { SqlClient } from "./client.js";
import { createDbClock } from "./clock.js";
import { SupabaseCreativeStore } from "./creative-store.js";
import { assertWorkerRole, createPgClient } from "./pg-client.js";
import { PgQueue } from "./queue.js";
import { PgSchedulerStore } from "./scheduler-store.js";
import { PgSendContext, type ShopeeCredential } from "./send-context.js";

const DEFAULT_IMAGE_HOSTS = ["shopee.com.br", "susercontent.com", "shopeemobile.com"];
const MAX_IMAGE_BYTES = 5_000_000;
const WRONG_STATE = "oferta_indisponivel";

export interface SqlDepsOptions {
  env: Record<string, string | undefined>;
  /** Injeção (testes): cliente já conectado. Em produção o pg é criado de DATABASE_URL. */
  db?: SqlClient;
  makeShopee?: (cred: ShopeeCredential, config: WorkerConfig) => ShopeeClient;
  makeTelegram?: (token: Secret) => Pick<TelegramClient, "sendPhoto">;
  emailTransport?: EmailTransport;
  creativeStore?: ExecutorDeps["creativeStore"];
  fetchImage?: typeof fetch;
  imageHosts?: string[];
  fetch?: typeof fetch;
}

/**
 * Monta o worker de produção sobre Postgres: relógio do banco, SchedulerStore, fila por RPC,
 * Vault, heartbeat persistido e alertas. Falha fechada: variável ausente (só o NOME aparece),
 * conexão como dono/superuser ou sem TLS impedem a partida.
 */
export function createSqlBuildDeps(opts: SqlDepsOptions): BuildDeps {
  return async (config: WorkerConfig, log: Logger) => {
    const env = opts.env;
    const missing: string[] = [];
    const need = (name: string) => {
      const v = env[name];
      if (v === undefined || v.trim() === "") missing.push(name);
      return v ?? "";
    };
    const affiliateHandle = need("AFFILIATE_HANDLE");
    if (!config.alertEmailTo) missing.push("ALERT_EMAIL_TO");
    const supabaseUrl = opts.creativeStore ? "" : need("SUPABASE_URL");
    const serviceKey = opts.creativeStore ? "" : need("SUPABASE_SERVICE_ROLE_KEY");
    if (missing.length > 0) throw new ConfigError(missing);

    const db =
      opts.db ??
      createPgClient(config.databaseUrl, {
        queryTimeoutMs: config.externalTimeoutMs,
        ...(env.DATABASE_SSL_CA ? { caCert: env.DATABASE_SSL_CA } : {}),
      });
    // o worker não pode ser dono do banco (migração achadinhos_worker)
    await assertWorkerRole(db);

    const transport = opts.emailTransport ?? createEmailTransportFromEnv(env, opts.fetch ? { fetch: opts.fetch } : {});
    const clock = createDbClock(db);
    await clock.sync();
    const alerts = createAlertService({ transport, to: config.alertEmailTo, now: () => clock.now().getTime() });

    const queue = new PgQueue(db);
    const ctx = new PgSendContext(db, { affiliateHandle: () => affiliateHandle });
    const imageHosts =
      opts.imageHosts ?? (env.IMAGE_ALLOWED_HOSTS ? env.IMAGE_ALLOWED_HOSTS.split(",").map((h) => h.trim()).filter(Boolean) : DEFAULT_IMAGE_HOSTS);

    const makeShopee =
      opts.makeShopee ??
      ((cred: ShopeeCredential, c: WorkerConfig) =>
        createShopeeClient(
          { appId: cred.appId, secret: cred.secret.reveal() },
          { endpoint: c.shopeeEndpoint, timeoutMs: c.externalTimeoutMs },
        ));
    const makeTelegram = opts.makeTelegram ?? ((t: Secret) => new TelegramClient({ token: t.reveal(), ...(opts.fetch ? { fetch: opts.fetch } : {}) }));

    // seleção por conta: a credencial vem do Vault a cada tick, nunca fica em cache de processo
    const selectOffer = async (input: SelectionInput) => {
      const cred = await ctx.shopeeCredential(input.accountId);
      if (!cred) throw new Error("credencial_shopee_ausente");
      return createOfferSelector(makeShopee(cred, config), { imageHosts, timeoutMs: config.externalTimeoutMs })(input);
    };

    const store = new PgSchedulerStore(db);

    // timeouts do executor cabem no lease: clients + shortLink + download + render + store + telegram + 3 finish
    const clientsMs = 5_000;
    const finishMs = 5_000;
    const renderMs = 15_000;
    const per = Math.max(
      1_000,
      Math.min(config.externalTimeoutMs, Math.floor((config.leaseMs - 5_000 - clientsMs - 3 * finishMs - 200 - renderMs) / 4)),
    );
    const creativeStore =
      opts.creativeStore ??
      new SupabaseCreativeStore({
        url: supabaseUrl,
        serviceRoleKey: new Secret(serviceKey),
        bucket: env.CREATIVE_BUCKET?.trim() || "creatives",
        timeoutMs: per,
        ...(opts.fetch ? { fetch: opts.fetch } : {}),
      });

    const executor = createSendExecutor({
      leaseMs: config.leaseMs,
      timeouts: { clientsMs, shortLinkMs: per, downloadMs: per, renderMs, storeMs: per, telegramMs: per, finishMs },
      allowedImageHosts: imageHosts,
      maxImageBytes: MAX_IMAGE_BYTES,
      clients: async (send) => {
        const [cred, token] = await Promise.all([ctx.shopeeCredential(send.accountId), ctx.telegramToken(send.channelId, send.accountId)]);
        if (!cred || !token) throw new Error("credencial_ausente");
        return { shopee: makeShopee(cred, config), telegram: makeTelegram(token) };
      },
      ...(opts.fetchImage ? { fetchImage: opts.fetchImage } : {}),
      renderCreative: renderCreativePng,
      creativeStore,
      finish: (id, args) => queue.finish(id, args),
    });

    const exec: SqlExecutor = {
      query: async <T,>(text: string, params?: unknown[]) => (await db.query(text, params)) as unknown as { rows: T[] },
    };
    const hb = new SqlHeartbeatStore(exec);
    const workerId = `${hostname()}-${process.pid}`.slice(0, 100);

    return {
      now: clock.now,
      scheduler: {
        runTick: async () => {
          await clock.sync();
          return runSchedulerTick({
            store,
            now: clock.now,
            selectOffer,
            log: (event, data) => log.warn(event, data),
          });
        },
      },
      queue: {
        listChannels: async () =>
          (await db.query<{ channel_id: string }>(
            "select distinct channel_id from public.sends where status in ('queued','sending') and channel_id is not null",
          )).rows.map((r) => r.channel_id),
        claim: async (channelId) => {
          const claimed = await queue.claimNextSend(channelId);
          if (!claimed) return null;
          const send = await ctx.loadClaimedSend(claimed.id);
          if (!send) {
            // oferta/grupo sumiu depois do claim: encerra sem tentar enviar nada
            await queue.finishSend(claimed.id, { status: "skipped", reason: WRONG_STATE });
            return null;
          }
          return send;
        },
      },
      executor: { run: (send) => executor.run(send) },
      alerts: {
        shopeeCredentialFailed: (c) => alerts.shopeeCredentialFailed(c),
        telegramBotLostAccess: (c) => alerts.telegramBotLostAccess(c),
        workerNoHeartbeat: (d) => alerts.workerNoHeartbeat(d),
      },
      groups: {
        deactivate: async (groupId, reason) => {
          // grupo sai do agendador e os queued dele viram skipped/grupo_inativo (teto do canal preservado)
          await db.transaction(async (tx) => {
            await tx.query("update public.groups set active = false where id = $1::uuid", [groupId]);
            const q = await tx.query<{ id: string }>(
              "select id from public.sends where group_id = $1::uuid and status = 'queued' for update",
              [groupId],
            );
            for (const row of q.rows) {
              await tx.query("select public.finish_send($1::uuid, 'skipped', 'grupo_inativo')", [row.id]);
            }
          });
          log.warn("worker.grupo_desativado", { groupId, reason });
        },
      },
      heartbeatStore: {
        write: async () => hb.record(workerId),
        read: async () => {
          const age = await hb.ageMs();
          return age === null ? null : new Date(clock.now().getTime() - age);
        },
      },
    };
  };
}
