import { createClock, isWithinWindow, type Clock } from "@achadinhos/domain";
import { createShopeeClient, type ShopeeClient } from "@achadinhos/shopee";
import { startMockShopeeServer } from "@achadinhos/shopee/testing";
import { createMockTelegramServer, TelegramClient } from "@achadinhos/telegram";
import { createAlertService, createInMemoryEmailTransport } from "@achadinhos/alerts";
import { renderCreativePng } from "@achadinhos/creative/render";
import { productPlaceholder } from "@achadinhos/creative";
import { createOfferSelector } from "../../src/offer-selection.js";
import { runSchedulerTick } from "../../src/scheduler.js";
import { MemoryStore, type StoredSend } from "../../src/memory-store.js";
import { createSendExecutor, type ClaimedSend, type FinishArgs } from "../../src/executor.js";
import { createWorkerRuntime } from "../../src/runtime.js";
import type { RuntimeDeps } from "../../src/runtime.js";

export const CUIABA = "America/Cuiaba";
const INTERVAL_MS = 60_000;
const DAILY_CAP = 200;
const LEASE_MS = 120_000;

const localDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: CUIABA }).format(d);

export interface Attempt { channelId: string; attemptedAt: Date; finishedAt: Date | null }

/**
 * Fila em memória com a semântica do `claim_next_send` (decisão 001): 1 `sending` por canal,
 * 60 s após o fim, teto 200/dia local, reaper de lease e janela (A8b) — tudo pelo relógio do BANCO.
 * É o substituto do Postgres neste e2e; o teste SQL equivalente está marcado em sql.e2e.test.ts.
 */
export class MemoryClaimQueue {
  readonly attempts: Attempt[] = [];
  readonly results = new Map<string, FinishArgs>();
  private readonly meta = new Map<string, { attemptedAt: Date; leaseExpiresAt: Date; attempt: Attempt }>();
  constructor(private readonly store: MemoryStore, private readonly clock: Clock) {}

  seedAttempts(channelId: string, n: number, at: Date) {
    for (let i = 0; i < n; i++) this.attempts.push({ channelId, attemptedAt: at, finishedAt: at });
  }

  private reap(channelId: string) {
    const now = this.clock.now();
    for (const s of this.store.sends) {
      const m = this.meta.get(s.id);
      if (s.channelId === channelId && s.status === "sending" && m && m.leaseExpiresAt < now) {
        s.status = "failed";
        s.reason = "lease_expirado_resultado_desconhecido";
        m.attempt.finishedAt = now;
      }
    }
  }

  async listChannels(): Promise<string[]> {
    return [...new Set(this.store.sends.map((s) => s.channelId))];
  }

  async claim(channelId: string, build: (s: StoredSend) => ClaimedSend): Promise<ClaimedSend | null> {
    this.reap(channelId);
    const now = this.clock.now();
    const mine = this.store.sends.filter((s) => s.channelId === channelId);
    if (mine.some((s) => s.status === "sending")) return null;
    const att = this.attempts.filter((a) => a.channelId === channelId);
    const last = Math.max(0, ...att.map((a) => a.finishedAt?.getTime() ?? 0));
    if (last && now.getTime() - last < INTERVAL_MS) return null;
    if (att.filter((a) => localDay(a.attemptedAt) === localDay(now)).length >= DAILY_CAP) return null;
    const queued = mine.filter((s) => s.status === "queued").sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime());
    for (const s of queued) {
      if (!this.store.group(s.automationId, s.groupId).active) {
        s.status = "skipped";
        s.reason = "grupo_inativo";
        continue;
      }
      const a = this.store.automation(s.automationId);
      const inside = isWithinWindow(now, { days: a.days, windowStart: a.windowStart, windowEnd: a.windowEnd, frequencyMin: a.frequencyMin, timezone: a.timezone });
      if (!inside) {
        s.status = "skipped";
        s.reason = "fora_da_janela";
        continue;
      }
      const attempt = { channelId, attemptedAt: now, finishedAt: null };
      this.attempts.push(attempt);
      s.status = "sending";
      this.meta.set(s.id, { attemptedAt: now, leaseExpiresAt: new Date(now.getTime() + LEASE_MS), attempt });
      return build(s);
    }
    return null;
  }

  async finish(sendId: string, args: FinishArgs): Promise<boolean> {
    const s = this.store.sends.find((x) => x.id === sendId);
    const m = this.meta.get(sendId);
    if (!s || !m) return false;
    this.reap(s.channelId);
    if (s.status !== "sending") return false;
    s.status = args.status;
    s.reason = "reason" in args ? args.reason : null;
    if (args.status === "sent") s.sentAt = this.clock.now();
    m.attempt.finishedAt = this.clock.now();
    this.results.set(sendId, args);
    return true;
  }
}

export async function createWorld(startIso: string, opts: { window?: [string, string]; nextRunAt?: string | null } = {}) {
  const shopeeServer = await startMockShopeeServer({ appId: "app", secret: "sec" });
  const tg = createMockTelegramServer();
  const clock = createClock(new Date(startIso));
  const store = new MemoryStore();
  store.addAutomation({
    id: "au1", accountId: "acc1", status: "active", days: [0, 1, 2, 3, 4, 5, 6],
    windowStart: opts.window?.[0] ?? "08:00", windowEnd: opts.window?.[1] ?? "20:00",
    frequencyMin: 60, filters: {}, timezone: CUIABA,
  });
  store.addGroup({
    automationId: "au1", groupId: "g1", accountId: "acc1", channelId: "c1", active: true,
    nextRunAt: opts.nextRunAt === null ? null : new Date(opts.nextRunAt ?? startIso),
  });
  const queue = new MemoryClaimQueue(store, clock);

  const shopee: ShopeeClient = createShopeeClient({ appId: "app", secret: "sec" }, { endpoint: shopeeServer.url, timeoutMs: 2_000 });
  const subIds: string[][] = [];
  const realGen = shopee.generateShortLink.bind(shopee);
  shopee.generateShortLink = async (p) => (subIds.push([...(p.subIds ?? [])]), realGen(p));
  const telegram = new TelegramClient({ transport: tg.transport });

  // foto de produto válida (PNG) gerada pelo próprio renderizador, sem rede
  const productPng = await renderCreativePng({
    title: "foto", imageUrl: productPlaceholder(200, "foto"), priceCurrent: 10, priceOld: 20, discountPct: 50, affiliateHandle: "x",
  });
  const storedPngs: Uint8Array[] = [];

  const executor = createSendExecutor({
    leaseMs: LEASE_MS,
    timeouts: { clientsMs: 2_000, shortLinkMs: 5_000, downloadMs: 5_000, renderMs: 20_000, storeMs: 5_000, telegramMs: 5_000, finishMs: 2_000 },
    allowedImageHosts: ["example.com"],
    maxImageBytes: 5_000_000,
    clients: async () => ({ shopee, telegram }),
    fetchImage: (async () => new Response(productPng as unknown as BodyInit, { headers: { "content-type": "image/png" } })) as unknown as typeof fetch,
    renderCreative: renderCreativePng,
    creativeStore: {
      put: async (png, id) => (storedPngs.push(png), { photoUrl: `https://signed.example/${id}?t=x`, objectPath: `creatives/${id}.png` }),
    },
    finish: (id, args) => queue.finish(id, args),
  });

  const build = (s: StoredSend): ClaimedSend => {
    const node = store.offers.find((o) => o.id === s.offerId)!.node;
    const rate = node.priceDiscountRate ?? 0;
    const current = node.priceMin;
    return {
      sendId: s.id, accountId: s.accountId, automationId: s.automationId, groupId: s.groupId,
      groupSubId: "g7", channelId: s.channelId, offerId: s.offerId!, chatId: -100123, affiliateHandle: "achadinhos",
      offer: {
        title: node.productName, imageUrl: node.imageUrl, productUrl: node.productLink,
        priceCurrent: current, priceOld: rate > 0 ? Math.round((current / (1 - rate / 100)) * 100) / 100 : current, discountPct: rate,
      },
    };
  };

  const transport = createInMemoryEmailTransport();
  const alerts = createAlertService({ transport, to: "ops@example.com", now: () => clock.now().getTime() });
  const selectOffer = createOfferSelector(shopee, { timeoutMs: 5_000, imageHosts: ["example.com"] });

  const runtimeDeps: RuntimeDeps = {
    config: { tickIntervalMs: 60_000, executorPollMs: 5_000, stallAlertMs: 600_000, shutdownGraceMs: 1_000 },
    log: { debug() {}, info() {}, warn() {}, error() {}, addSecret() {} },
    now: () => clock.now(),
    scheduler: { runTick: () => runSchedulerTick({ store, now: clock.now, selectOffer, dedupeDays: 7 }) },
    queue: { listChannels: () => queue.listChannels(), claim: (ch) => queue.claim(ch, build) },
    executor,
    groups: { deactivate: async (groupId, reason) => store.deactivateGroup(groupId, reason) },
    alerts: {
      shopeeCredentialFailed: (c) => alerts.shopeeCredentialFailed(c),
      telegramBotLostAccess: (c) => alerts.telegramBotLostAccess(c),
      workerNoHeartbeat: (d) => alerts.workerNoHeartbeat(d),
    },
  };
  const runtime = createWorkerRuntime(runtimeDeps);

  /** Insere um `queued` direto (o fixture da Shopee só tem 1 oferta). */
  async function enqueueDirect(key: string, scheduledFor: Date) {
    await store.transaction(async (tx) => {
      const offer = await tx.upsertOffer("acc1", (await selectOffer({
        accountId: "acc1", automationId: "au1", groupId: "g1", filters: {}, history: [], now: clock.now(), dedupeDays: 7,
      }) as { kind: "offer"; offer: Parameters<typeof tx.upsertOffer>[1] }).offer);
      await tx.insertSend({
        accountId: "acc1", automationId: "au1", groupId: "g1", channelId: "c1", offerId: offer.id,
        status: "queued", reason: null, idempotencyKey: key, scheduledFor,
      });
    });
  }

  return {
    clock, store, queue, tg, shopee, subIds, runtime, storedPngs, transport, alerts, enqueueDirect,
    sentMessages: () => tg.getSentMessages().filter((m) => m.method === "sendPhoto"),
    close: () => shopeeServer.close(),
  };
}
