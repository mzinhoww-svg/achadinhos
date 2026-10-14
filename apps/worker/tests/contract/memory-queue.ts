import { LEASE_EXPIRED_REASON, type ClaimedSend, type FinishInput, type QueuePort } from "../../src/ports.js";
import type { HarnessFactory, QueueHarness, SendRow } from "./harness.js";

const INTERVAL_MS = 60_000;
const LEASE_MS = 120_000;
const DAILY_CAP = 200;

interface Row extends SendRow {
  seq: number;
  scheduledFor: Date;
  finishedAt: Date | null;
  leaseExpiresAt: Date | null;
}

function localDay(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);
}

/** Implementação de referência: serializa claims como o advisory lock faria. */
export const memoryHarness: HarnessFactory = () => {
  let now = new Date("2026-10-14T15:00:00Z");
  let tz = "America/Cuiaba";
  let seq = 0;
  const rows = new Map<string, Row>();
  let lock: Promise<unknown> = Promise.resolve();

  const reap = (channelId: string) => {
    for (const r of rows.values()) {
      if (r.channelId === channelId && r.status === "sending" && r.leaseExpiresAt! < now) {
        r.status = "failed";
        r.reason = LEASE_EXPIRED_REASON;
        r.finishedAt = now;
      }
    }
  };

  const claim = (channelId: string): ClaimedSend | null => {
    reap(channelId);
    const mine = [...rows.values()].filter((r) => r.channelId === channelId);
    if (mine.some((r) => r.status === "sending")) return null;
    const last = Math.max(0, ...mine.map((r) => r.finishedAt?.getTime() ?? 0));
    if (last && now.getTime() - last < INTERVAL_MS) return null;
    const today = localDay(now, tz);
    const used = mine.filter((r) => r.attemptedAt && localDay(r.attemptedAt, tz) === today).length;
    if (used >= DAILY_CAP) return null;
    const next = mine
      .filter((r) => r.status === "queued")
      .sort((a, b) => b.priority - a.priority || a.scheduledFor.getTime() - b.scheduledFor.getTime() || a.seq - b.seq)[0];
    if (!next) return null;
    next.status = "sending";
    next.attemptedAt = now;
    next.leaseExpiresAt = new Date(now.getTime() + LEASE_MS);
    return { id: next.id, channelId, leaseExpiresAt: next.leaseExpiresAt };
  };

  const serial = <T>(fn: () => T): Promise<T> => {
    const p = lock.then(async () => {
      await Promise.resolve(); // cede o event loop: simula ida e volta ao banco
      return fn();
    });
    lock = p.catch(() => undefined);
    return p;
  };

  const worker = (): QueuePort => ({
    claimNextSend: (channelId) => serial(() => claim(channelId)),
    finishSend: (id: string, input: FinishInput) =>
      serial(() => {
        const r = rows.get(id);
        if (!r) return false;
        reap(r.channelId);
        if (r.status !== "sending") return false;
        r.status = input.status;
        r.reason = input.reason ?? null;
        r.finishedAt = now;
        r.leaseExpiresAt = null;
        return true;
      }),
  });

  const h: QueueHarness = {
    newWorker: worker,
    async enqueue({ channelId, priority = 0 }) {
      const id = `send-${++seq}`;
      rows.set(id, { id, seq, channelId, status: "queued", reason: null, priority, attemptedAt: null, scheduledFor: now, finishedAt: null, leaseExpiresAt: null });
      return id;
    },
    async seedAttempted(channelId, count, at) {
      for (let i = 0; i < count; i++) {
        const id = `send-${++seq}`;
        rows.set(id, { id, seq, channelId, status: "sent", reason: null, priority: 0, attemptedAt: at, scheduledFor: at, finishedAt: at, leaseExpiresAt: null });
      }
    },
    async setDbNow(at) {
      now = at;
    },
    dbNow: () => now,
    async get(id) {
      const r = rows.get(id);
      if (!r) throw new Error(`send ${id} inexistente`);
      return r;
    },
    async setTimezone(z) {
      tz = z;
    },
  };
  return h;
};
