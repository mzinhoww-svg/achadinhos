import { beforeEach, describe, expect, it } from "vitest";
import { LEASE_EXPIRED_REASON } from "../../src/ports.js";
import type { HarnessFactory, QueueHarness } from "./harness.js";

const CH = "canal-1";
const at = (iso: string) => new Date(iso);
// Cuiabá = UTC-4 (IANA America/Cuiaba): 00:00 local = 04:00Z.

/** Suíte de concorrência/fuso (T7-10). Reutilizar com a fila SQL passando outra factory. */
export function runQueueContract(name: string, factory: HarnessFactory): void {
  describe(`${name}: contrato da fila`, () => {
    let h: QueueHarness;
    beforeEach(async () => {
      h = await factory();
      await h.setDbNow(at("2026-10-14T15:00:00Z"));
    });

    describe("2+ workers", () => {
      it("N workers concorrentes no mesmo canal: exatamente 1 claim", async () => {
        for (let i = 0; i < 5; i++) await h.enqueue({ channelId: CH });
        const workers = Array.from({ length: 4 }, () => h.newWorker());
        const results = await Promise.all(workers.map((w) => w.claimNextSend(CH)));
        const won = results.filter((r) => r !== null);
        expect(won).toHaveLength(1);
        expect((await h.get(won[0]!.id)).status).toBe("sending");
      });

      it("canais distintos não se bloqueiam", async () => {
        await h.enqueue({ channelId: "a" });
        await h.enqueue({ channelId: "b" });
        const [x, y] = await Promise.all([h.newWorker().claimNextSend("a"), h.newWorker().claimNextSend("b")]);
        expect(x).not.toBeNull();
        expect(y).not.toBeNull();
      });

      it("respeita 60 s após finalizar: 59 s nega, 60 s libera", async () => {
        await h.enqueue({ channelId: CH });
        await h.enqueue({ channelId: CH });
        const w = h.newWorker();
        const first = (await w.claimNextSend(CH))!;
        await w.finishSend(first.id, { status: "sent", externalMessageId: "m1" });
        await h.setDbNow(new Date(h.dbNow().getTime() + 59_000));
        expect(await h.newWorker().claimNextSend(CH)).toBeNull();
        await h.setDbNow(new Date(h.dbNow().getTime() + 1_000));
        expect(await h.newWorker().claimNextSend(CH)).not.toBeNull();
      });

      it("prioridade 100 vai primeiro mas não fura 1-por-canal", async () => {
        const low = await h.enqueue({ channelId: CH });
        const high = await h.enqueue({ channelId: CH, priority: 100 });
        const w = h.newWorker();
        const c = (await w.claimNextSend(CH))!;
        expect(c.id).toBe(high);
        expect(await h.newWorker().claimNextSend(CH)).toBeNull();
        expect((await h.get(low)).status).toBe("queued");
      });
    });

    describe("crash após claim", () => {
      it("antes do lease expirar ninguém assume o canal", async () => {
        await h.enqueue({ channelId: CH });
        await h.enqueue({ channelId: CH });
        await h.newWorker().claimNextSend(CH); // worker "morre" aqui
        await h.setDbNow(new Date(h.dbNow().getTime() + 119_000));
        expect(await h.newWorker().claimNextSend(CH)).toBeNull();
      });

      it("após o lease: reaper marca failed com motivo, sem retry, e libera o canal depois de 60 s", async () => {
        const a = await h.enqueue({ channelId: CH });
        const b = await h.enqueue({ channelId: CH });
        const dead = (await h.newWorker().claimNextSend(CH))!;
        expect(dead.id).toBe(a);
        await h.setDbNow(new Date(h.dbNow().getTime() + 121_000));
        await h.newWorker().claimNextSend(CH); // dispara o reaper
        const row = await h.get(a);
        expect(row.status).toBe("failed");
        expect(row.reason).toBe(LEASE_EXPIRED_REASON);
        // 60 s depois do reaper/lease o canal está livre e o próximo da fila sai.
        await h.setDbNow(new Date(h.dbNow().getTime() + 61_000));
        const again = await h.newWorker().claimNextSend(CH);
        expect(again?.id).toBe(b);
        expect((await h.get(a)).status).toBe("failed"); // nunca volta a queued
      });

      it("finish tardio do worker que 'voltou do coma' não ressuscita o send reapado", async () => {
        const a = await h.enqueue({ channelId: CH });
        const slow = h.newWorker();
        const c = (await slow.claimNextSend(CH))!;
        await h.setDbNow(new Date(h.dbNow().getTime() + 121_000));
        await h.newWorker().claimNextSend(CH); // dispara o reaper
        const accepted = await slow.finishSend(c.id, { status: "sent", externalMessageId: "tarde" });
        expect(accepted).toBe(false);
        const row = await h.get(a);
        expect(row.status).toBe("failed");
        expect(row.reason).toBe(LEASE_EXPIRED_REASON);
      });

      it("finish duplicado é ignorado (idempotente)", async () => {
        await h.enqueue({ channelId: CH });
        const w = h.newWorker();
        const c = (await w.claimNextSend(CH))!;
        expect(await w.finishSend(c.id, { status: "sent", externalMessageId: "m-ok" })).toBe(true);
        expect(await w.finishSend(c.id, { status: "failed", reason: "x" })).toBe(false);
        expect((await h.get(c.id)).status).toBe("sent");
      });
    });

    describe("relógio do worker adiantado", () => {
      it("o intervalo e o lease seguem o relógio do banco, não o do processo", async () => {
        await h.enqueue({ channelId: CH });
        await h.enqueue({ channelId: CH });
        const realNow = Date.now;
        try {
          const w = h.newWorker();
          const c = (await w.claimNextSend(CH))!;
          await w.finishSend(c.id, { status: "sent", externalMessageId: "m-ok" });
          const skewed = realNow() + 3_600_000; // worker 1 h adiantado
          Date.now = () => skewed;
          expect(await h.newWorker().claimNextSend(CH)).toBeNull();
          expect(c.leaseExpiresAt.getTime()).toBe(h.dbNow().getTime() + 120_000);
        } finally {
          Date.now = realNow;
        }
      });
    });

    describe("fuso America/Cuiaba e teto diário", () => {
      it("200 tentativas no dia local bloqueiam; 201º não sai", async () => {
        await h.setDbNow(at("2026-10-14T20:00:00Z")); // 16:00 local
        await h.seedAttempted(CH, 200, at("2026-10-14T15:00:00Z"));
        await h.enqueue({ channelId: CH });
        expect(await h.newWorker().claimNextSend(CH)).toBeNull();
      });

      it("199 tentativas ainda deixam passar 1", async () => {
        await h.setDbNow(at("2026-10-14T20:00:00Z"));
        await h.seedAttempted(CH, 199, at("2026-10-14T15:00:00Z"));
        await h.enqueue({ channelId: CH });
        expect(await h.newWorker().claimNextSend(CH)).not.toBeNull();
      });

      it("23:59:30 local ainda é o dia velho; 00:00:30 local zera o teto", async () => {
        // 23:59:30 de 14/10 em Cuiabá = 03:59:30Z de 15/10
        await h.seedAttempted(CH, 200, at("2026-10-14T20:00:00Z"));
        await h.enqueue({ channelId: CH });
        await h.setDbNow(at("2026-10-15T03:59:30Z"));
        expect(await h.newWorker().claimNextSend(CH)).toBeNull();
        await h.setDbNow(at("2026-10-15T04:00:30Z")); // 00:00:30 local
        expect(await h.newWorker().claimNextSend(CH)).not.toBeNull();
      });

      it("o corte é o dia local, não UTC: tentativa às 21:00Z (17:00 local) não conta em 04:30Z", async () => {
        await h.seedAttempted(CH, 200, at("2026-10-14T21:00:00Z"));
        await h.enqueue({ channelId: CH });
        await h.setDbNow(at("2026-10-15T00:30:00Z")); // 20:30 local, mesmo dia local, já é 15/10 UTC
        expect(await h.newWorker().claimNextSend(CH)).toBeNull();
      });

      it("conta com outro fuso IANA usa o próprio dia local", async () => {
        await h.setTimezone("Asia/Tokyo"); // UTC+9
        await h.seedAttempted(CH, 200, at("2026-10-14T10:00:00Z")); // 19:00 JST de 14/10
        await h.enqueue({ channelId: CH });
        await h.setDbNow(at("2026-10-14T14:59:00Z")); // 23:59 JST: mesmo dia
        expect(await h.newWorker().claimNextSend(CH)).toBeNull();
        await h.setDbNow(at("2026-10-14T15:01:00Z")); // 00:01 JST de 15/10
        expect(await h.newWorker().claimNextSend(CH)).not.toBeNull();
      });
    });
  });
}
