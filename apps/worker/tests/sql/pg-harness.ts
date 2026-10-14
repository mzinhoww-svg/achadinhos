import type { PGlite } from "@electric-sql/pglite";
import type { QueuePort } from "../../src/ports.js";
import { PgQueue } from "../../src/sql/queue.js";
import type { SqlClient } from "../../src/sql/client.js";
import type { HarnessFactory, QueueHarness, SendRow } from "../contract/harness.js";
import { pgliteClient } from "./pglite-client.js";
import { seedAccount, type Seed } from "./fixtures.js";

/**
 * Harness da suíte de contrato sobre o Postgres embutido. O relógio do banco é simulado pela
 * costura `queue_internal.claim_next_send_at` (a RPC pública só passa now()); o resto do caminho
 * (grants, RPC, adaptador) é o de produção.
 */
export function pgHarness(db: PGlite): HarnessFactory {
  return async () => {
    const seed = await seedAccountAsOwner(db);
    let now = new Date("2026-10-14T15:00:00Z");
    let seq = 0;
    const channels = new Map<string, string>(); // nome do contrato -> uuid
    const names = new Map<string, string>();

    const owner = async <T>(fn: () => Promise<T>) => {
      await db.exec("reset role");
      try {
        return await fn();
      } finally {
        await db.exec("set role service_role");
      }
    };

    const channelOf = async (name: string): Promise<string> => {
      const hit = channels.get(name);
      if (hit) return hit;
      const id = await owner(async () => {
        if (channels.size === 0) return seed.channelId;
        const tok = (await db.query<{ id: string }>("select vault.create_secret($1,$2) as id", ["t", `c-${Math.random()}`])).rows[0]!;
        return (
          await db.query<{ id: string }>(
            "insert into public.channels (account_id, kind, config_secret_id) values ($1,'telegram',$2) returning id",
            [seed.accountId, tok.id],
          )
        ).rows[0]!.id;
      });
      channels.set(name, id);
      names.set(id, name);
      return id;
    };

    // intercepta só o SELECT do claim para usar a costura com o relógio simulado
    const base = pgliteClient(db);
    const client: SqlClient = {
      ...base,
      query: (text, params) =>
        text.includes("public.claim_next_send")
          ? // a costura é do dono (sem USAGE para service_role, de propósito)
            owner(() => base.query("select * from queue_internal.claim_next_send_at($1, $2)", [params![0], now]))
          : base.query(text, params),
    };
    const inner = new PgQueue(client);

    const worker = (): QueuePort => ({
      claimNextSend: async (name) => inner.claimNextSend(await channelOf(name)),
      finishSend: async (id, input) => {
        const ok = await inner.finishSend(id, input);
        if (ok) {
          // finish_send usa now() do banco; alinha ao relógio simulado (triggers off só no teste)
          await owner(async () => {
            await db.exec("set session_replication_role = replica");
            await db.query(
              "update public.sends set finished_at = $2, sent_at = case when status = 'sent' then $2::timestamptz end where id = $1",
              [id, now],
            );
            await db.exec("set session_replication_role = origin");
          });
        }
        return ok;
      },
    });

    const h: QueueHarness = {
      newWorker: worker,
      async enqueue({ channelId, priority = 0 }) {
        const ch = await channelOf(channelId);
        return owner(async () => {
          const n = ++seq;
          const r = await db.query<{ id: string }>(
            `insert into public.sends (account_id, channel_id, priority, status, scheduled_for, created_at, idempotency_key)
             values ($1,$2,$3,'queued',$4,$4,$5) returning id`,
            // FIFO por ordem de chamada: ids são aleatórios, então o desempate é o instante
            [seed.accountId, ch, priority, new Date(now.getTime() - (1_000_000 - n)), `harness:${n}`],
          );
          return r.rows[0]!.id;
        });
      },
      async seedAttempted(channelId, count, at) {
        const ch = await channelOf(channelId);
        await owner(async () => {
          for (let i = 0; i < count; i++) {
            await db.query(
              `insert into public.sends (account_id, channel_id, status, scheduled_for, created_at, attempted_at, finished_at, sent_at, idempotency_key)
               values ($1,$2,'sent',$3,$3,$3,$3,$3,$4)`,
              [seed.accountId, ch, at, `harness-seed:${++seq}`],
            );
          }
        });
      },
      async setDbNow(at) {
        now = at;
      },
      dbNow: () => now,
      async get(id) {
        return owner(async () => {
          const r = await db.query<{ id: string; channel_id: string; status: SendRow["status"]; reason: string | null; priority: number; attempted_at: Date | null }>(
            "select id, channel_id, status, reason, priority, attempted_at from public.sends where id = $1",
            [id],
          );
          const x = r.rows[0];
          if (!x) throw new Error(`send ${id} inexistente`);
          return { id: x.id, channelId: x.channel_id, status: x.status, reason: x.reason, priority: x.priority, attemptedAt: x.attempted_at };
        });
      },
      async setTimezone(tz) {
        await owner(async () => {
          await db.query("update public.accounts set timezone = $2 where account_id = $1", [seed.accountId, tz]);
        });
      },
    };
    return h;
  };
}

async function seedAccountAsOwner(db: PGlite): Promise<Seed> {
  await db.exec("reset role");
  try {
    return await seedAccount(db, Math.floor(Math.random() * 1e9));
  } finally {
    await db.exec("set role service_role");
  }
}
