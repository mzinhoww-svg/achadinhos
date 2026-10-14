import { describe, expect, it } from "vitest";
import { InMemoryEmailTransport, createAlertService } from "@achadinhos/alerts";
import { MemoryHeartbeatStore, createHeartbeatPublisher } from "../../src/heartbeat-store.js";
import { createHeartbeatMonitor } from "../../src/heartbeat-monitor.js";

const STALE = 180_000;

function setup() {
  let t = 1_000_000;
  const clock = { now: () => t, advance: (ms: number) => (t += ms) };
  const store = new MemoryHeartbeatStore(clock.now);
  const transport = new InMemoryEmailTransport();
  const alerts = createAlertService({ transport, now: clock.now, to: "ops@example.test", heartbeatThresholdMs: STALE });
  const monitor = createHeartbeatMonitor({ store, alerts, staleAfterMs: STALE });
  return { clock, store, transport, monitor };
}

describe("publisher", () => {
  it("grava batimento só quando o tick termina sem erro", async () => {
    const { store } = setup();
    const pub = createHeartbeatPublisher({ store, workerId: "w1", onError: () => {} });
    await expect(pub.runTick(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(await store.ageMs()).toBeNull();
    await pub.runTick(async () => {});
    expect(await store.ageMs()).toBe(0);
  });

  it("falha ao gravar o batimento não derruba o tick (vai para onError)", async () => {
    const errors: unknown[] = [];
    const store = { record: async () => { throw new Error("db fora"); }, ageMs: async () => null };
    const pub = createHeartbeatPublisher({ store, workerId: "w1", onError: (e) => errors.push(e) });
    await expect(pub.runTick(async () => {})).resolves.toBeUndefined();
    expect(errors).toHaveLength(1);
  });
});

describe("monitor", () => {
  it("batimento recente: sem alerta", async () => {
    const { store, monitor, transport } = setup();
    await store.record("w1");
    expect(await monitor.check()).toMatchObject({ healthy: true, alerted: false });
    expect(transport.emails).toHaveLength(0);
  });

  it("parado há mais de 3 min: um e-mail, sem repetir enquanto durar", async () => {
    const { clock, store, monitor, transport } = setup();
    await store.record("w1");
    clock.advance(STALE + 1);
    expect(await monitor.check()).toMatchObject({ healthy: false, alerted: true });
    expect(await monitor.check()).toMatchObject({ healthy: false, alerted: false });
    expect(transport.emails).toHaveLength(1);
    expect(transport.emails[0]!.subject).toContain("heartbeat");
  });

  it("nunca houve batimento: alerta (falha fechada)", async () => {
    const { monitor, transport } = setup();
    expect(await monitor.check()).toMatchObject({ healthy: false, alerted: true });
    expect(transport.emails).toHaveLength(1);
  });

  it("recuperou e parou de novo: alerta de novo", async () => {
    const { clock, store, monitor, transport } = setup();
    await store.record("w1");
    clock.advance(STALE + 1);
    await monitor.check();
    await store.record("w1");
    expect(await monitor.check()).toMatchObject({ healthy: true });
    clock.advance(STALE + 1);
    await monitor.check();
    expect(transport.emails).toHaveLength(2);
  });

  it("erro ao ler o banco propaga e não conta como worker morto", async () => {
    const { transport } = setup();
    const store = { record: async () => {}, ageMs: async (): Promise<number | null> => { throw new Error("db fora"); } };
    const alerts = createAlertService({ transport: new InMemoryEmailTransport() });
    const monitor = createHeartbeatMonitor({ store, alerts, staleAfterMs: STALE });
    await expect(monitor.check()).rejects.toThrow("db fora");
    expect(transport.emails).toHaveLength(0);
  });

  it("falha do transporte de e-mail propaga e permite nova tentativa", async () => {
    let fail = true;
    const { clock, store } = setup();
    const sent: unknown[] = [];
    const transport = { send: async (m: unknown) => { if (fail) throw new Error("smtp fora"); sent.push(m); } };
    const alerts = createAlertService({ transport, now: clock.now, heartbeatThresholdMs: STALE });
    const monitor = createHeartbeatMonitor({ store, alerts, staleAfterMs: STALE });
    await expect(monitor.check()).rejects.toThrow("smtp fora");
    fail = false;
    expect(await monitor.check()).toMatchObject({ alerted: true });
    expect(sent).toHaveLength(1);
  });
});
