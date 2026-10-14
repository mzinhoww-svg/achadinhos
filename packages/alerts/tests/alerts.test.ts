import { describe, it, expect } from "vitest";
import { AlertService, InMemoryEmailTransport } from "../src/index";
import { AlertCauses } from "../src/types";

describe("alerts dedup", () => {
  it("sends once per cause until resolve", async () => {
    process.env.ALERT_EMAIL_TO = "mazinhoww@gmail.com";
    const tp = new InMemoryEmailTransport();
    const now = 1_000_000;
    const alerts = new AlertService(tp, { now: () => now });
    const r1 = await alerts.alert(AlertCauses.ShopeeCredentialFailed);
    const r2 = await alerts.alert(AlertCauses.ShopeeCredentialFailed);
    expect(r1.sent).toBe(true);
    expect(r2.sent).toBe(false);
    expect(r2.duplicate).toBe(true);
    expect(tp.emails).toHaveLength(1);
    expect(JSON.stringify(tp.emails[0])).not.toContain("SECRET");
    alerts.resolve(AlertCauses.ShopeeCredentialFailed);
    const r3 = await alerts.alert(AlertCauses.ShopeeCredentialFailed);
    expect(r3.sent).toBe(true);
    expect(tp.emails).toHaveLength(2);
  });

  it("defaults recipient to mazinhoww@gmail.com", async () => {
    const saved = process.env.ALERT_EMAIL_TO;
    delete process.env.ALERT_EMAIL_TO;
    const tp = new InMemoryEmailTransport();
    const alerts = new AlertService(tp);
    await alerts.alert("custom");
    expect(tp.emails[0].to).toBe("mazinhoww@gmail.com");
    if (saved) process.env.ALERT_EMAIL_TO = saved;
  });

  it("heartbeat alert after 10 min", async () => {
    const tp = new InMemoryEmailTransport();
    const now = 10_000_000;
    const alerts = new AlertService(tp, { now: () => now });
    const last = now - 11 * 60 * 1000;
    const r = await alerts.checkHeartbeat(last);
    expect(r.sent).toBe(true);
    expect(tp.emails).toHaveLength(1);
  });
});