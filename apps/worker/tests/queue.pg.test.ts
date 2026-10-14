import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { runQueueContract } from "./contract/queue-contract.js";
import { createDb } from "./sql/pglite-db.js";
import { pgHarness } from "./sql/pg-harness.js";
import { asOwner, pgliteClient } from "./sql/pglite-client.js";
import { seedAccount } from "./sql/fixtures.js";
import { PgQueue } from "../src/sql/queue.js";

let db: PGlite;
beforeAll(async () => {
  db = await createDb();
  await db.exec("set role service_role");
}, 60_000);
afterAll(async () => db?.close());

// A mesma suíte que valida a fila em memória, agora contra as RPCs reais (T7-02/T7-03).
runQueueContract("Postgres embutido (RPC real)", async () => pgHarness(db)());

describe("PgQueue: adaptador das RPCs", () => {
  it("finish grava link, criativo e texto; reenvio do finish é ignorado", async () => {
    const s = await asOwner(db, () => seedAccount(db, 500));
    const id = await asOwner(db, async () =>
      (
        await db.query<{ id: string }>(
          "insert into public.sends (account_id, channel_id, idempotency_key) values ($1,$2,'k-finish') returning id",
          [s.accountId, s.channelId],
        )
      ).rows[0]!.id,
    );
    const q = new PgQueue(pgliteClient(db));
    const claimed = await q.claimNextSend(s.channelId);
    expect(claimed?.id).toBe(id);
    expect(claimed?.leaseExpiresAt).toBeInstanceOf(Date);

    const ok = await q.finish(id, {
      status: "sent",
      externalMessageId: "tg-42",
      shortLink: "https://s.shopee.com.br/abc",
      creativeUrl: "criativos/abc.png",
      messageText: "legenda",
    });
    expect(ok).toBe(true);
    expect(await q.finish(id, { status: "failed", reason: "x" })).toBe(false);

    const row = await asOwner(db, async () =>
      (await db.query<Record<string, unknown>>("select status, external_message_id, short_link, creative_url, message_text from public.sends where id=$1", [id])).rows[0],
    );
    expect(row).toEqual({
      status: "sent",
      external_message_id: "tg-42",
      short_link: "https://s.shopee.com.br/abc",
      creative_url: "criativos/abc.png",
      message_text: "legenda",
    });
  });

  it("claim sem envio elegível devolve null (não lança)", async () => {
    const s = await asOwner(db, () => seedAccount(db, 501));
    expect(await new PgQueue(pgliteClient(db)).claimNextSend(s.channelId)).toBeNull();
  });

  it("finish sent sem externalMessageId é erro do banco (nunca marca enviado sem prova)", async () => {
    const s = await asOwner(db, () => seedAccount(db, 502));
    const id = await asOwner(db, async () =>
      (
        await db.query<{ id: string }>(
          "insert into public.sends (account_id, channel_id, idempotency_key) values ($1,$2,'k-nomsg') returning id",
          [s.accountId, s.channelId],
        )
      ).rows[0]!.id,
    );
    const q = new PgQueue(pgliteClient(db));
    await q.claimNextSend(s.channelId);
    await expect(q.finishSend(id, { status: "sent" })).rejects.toThrow();
  });

  it("reapExpired devolve quantos sending foram reapados", async () => {
    const q = new PgQueue(pgliteClient(db));
    expect(await q.reapExpired()).toBeTypeOf("number");
  });
});
