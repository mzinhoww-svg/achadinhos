import { describe, it, expect } from "vitest";
import { AlertService, InMemoryEmailTransport } from "../src/index";
import { HttpEmailTransport, InMemoryEmailTransport as Mem } from "../src/transport";
import { AlertCauses } from "../src/types";
import { EmailTimeoutError } from "../src/errors";

describe("QA blockers", () => {
  it("concorrencia: dois disparos simultaneos enviam 1 e-mail", async () => {
    const tp = new InMemoryEmailTransport();
    const alerts = new AlertService(tp);
    const [r1, r2] = await Promise.all([
      alerts.alert(AlertCauses.ShopeeCredentialFailed),
      alerts.alert(AlertCauses.ShopeeCredentialFailed),
    ]);
    expect(tp.emails).toHaveLength(1);
  });

  it("heartbeat saudavel resolve e permite novo alerta depois", async () => {
    const tp = new InMemoryEmailTransport();
    const t0 = 10_000_000;
    const alerts = new AlertService(tp, { now: () => t0 });
    await alerts.checkHeartbeat(t0 - 11 * 60 * 1000); // cai
    expect(tp.emails).toHaveLength(1);
    await alerts.checkHeartbeat(t0); // volta
    // cai 1h depois
    const alerts2 = new AlertService(tp, { now: () => t0 + 60 * 60 * 1000 });
    await alerts2.checkHeartbeat(t0 + 60 * 60 * 1000 - 11 * 60 * 1000);
    expect(tp.emails).toHaveLength(2);
  });

  it("heartbeat invalido/ausente alerta (falha fechada)", async () => {
    const tp = new InMemoryEmailTransport();
    const alerts = new AlertService(tp, { now: () => 10_000_000 });
    for (const v of [undefined, null, NaN, "lixo"] as any[]) {
      const tp2 = new InMemoryEmailTransport();
      const a = new AlertService(tp2, { now: () => 10_000_000 });
      const r = await a.checkHeartbeat(v);
      expect(r.sent).toBe(true);
      expect(tp2.emails).toHaveLength(1);
    }
  });

  it("dedup com escopo: grupos diferentes geram dois e-mails", async () => {
    const tp = new InMemoryEmailTransport();
    const alerts = new AlertService(tp);
    await alerts.telegramBotLostAccess({ group: "-100A" } as any);
    await alerts.telegramBotLostAccess({ group: "-100B" } as any);
    expect(tp.emails).toHaveLength(2);
  });

  it("segredo aninhado e padroes nao vazam no corpo", async () => {
    const tp = new InMemoryEmailTransport();
    const alerts = new AlertService(tp);
    await alerts.alert(AlertCauses.TelegramBotLostAccess, {
      error: new Error("request to https://api.telegram.org/bot123456789:AAH-SECRET/getMe failed Signature=ABC123"),
      details: { token: "tok", apiKey: "key", nested: { authorization: "Bearer TOPSECRET" } },
    } as any);
    const body = tp.emails[0].text ?? "";
    expect(body).not.toContain("AAH-SECRET");
    expect(body).not.toContain("tok");
    expect(body).not.toContain("key");
    expect(body).not.toContain("TOPSECRET");
    expect(body).not.toContain("ABC123");
    expect(body).not.toContain("bot123456789");
  });

  it("provedor 200 com corpo invalido falha fechado", async () => {
    const htmlFetch = (async () => new Response("<html>", { status: 200 })) as unknown as typeof fetch;
    const t1 = new HttpEmailTransport("k", { fetch: htmlFetch, timeoutMs: 20, endpoint: "https://x" });
    await expect(t1.send({ to: "a@b.com", subject: "s", text: "x" })).rejects.toBeInstanceOf(Error);

    const errFetch = (async () => new Response(JSON.stringify({ error: "bad" }), { status: 200 })) as unknown as typeof fetch;
    const t2 = new HttpEmailTransport("k", { fetch: errFetch, timeoutMs: 20, endpoint: "https://x" });
    await expect(t2.send({ to: "a@b.com", subject: "s", text: "x" })).rejects.toBeInstanceOf(Error);
  });
});