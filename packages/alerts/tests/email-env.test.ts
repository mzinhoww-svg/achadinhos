import { describe, expect, it } from "vitest";
import {
  EmailConfigError,
  EmailTimeoutError,
  createAlertService,
  createEmailTransportFromEnv,
} from "../src/index";

const KEY = "k-test-0123456789-not-real";
const ENV = {
  EMAIL_PROVIDER_ENDPOINT: "https://mail.provider.example/v1/send",
  EMAIL_PROVIDER_API_KEY: KEY,
  EMAIL_FROM: "alertas@achadinhos.example",
};

function okFetch(calls: Array<{ url: string; init: RequestInit }>): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return { ok: true, status: 200, text: async () => JSON.stringify({ id: "m-1" }) };
  }) as unknown as typeof fetch;
}

describe("createEmailTransportFromEnv", () => {
  it("lê endpoint, chave e remetente do env e envia por POST JSON com Bearer", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const t = createEmailTransportFromEnv(ENV, { fetch: okFetch(calls) });
    await t.send({ to: "ops@example.test", subject: "s", text: "corpo" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(ENV.EMAIL_PROVIDER_ENDPOINT);
    expect(calls[0]!.init.method).toBe("POST");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({
      from: ENV.EMAIL_FROM,
      to: "ops@example.test",
      subject: "s",
    });
  });

  it("variável ausente: erro cita só o NOME da variável", () => {
    for (const name of Object.keys(ENV) as Array<keyof typeof ENV>) {
      const env: Record<string, string | undefined> = { ...ENV, [name]: undefined };
      try {
        createEmailTransportFromEnv(env);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(EmailConfigError);
        expect((e as EmailConfigError).vars).toEqual([name]);
        expect(String(e)).not.toContain(KEY);
      }
    }
  });

  it.each([
    ["http puro", "http://mail.provider.example/send"],
    ["userinfo", "https://user:pw-secreta@mail.provider.example/send"],
    ["não é URL", "isto-nao-e-url-com-segredo"],
    ["esquema estranho", "ftp://mail.provider.example/send"],
  ])("endpoint inválido (%s) é recusado sem vazar o valor", (_n, endpoint) => {
    try {
      createEmailTransportFromEnv({ ...ENV, EMAIL_PROVIDER_ENDPOINT: endpoint });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(EmailConfigError);
      expect(String(e)).not.toContain("pw-secreta");
      expect(String(e)).not.toContain("com-segredo");
    }
  });

  it("timeout total vem de EMAIL_TIMEOUT_MS e aborta fetch pendurado", async () => {
    let aborted = false;
    const hang = ((_u: string, init: RequestInit) =>
      new Promise((_, rej) => {
        init.signal?.addEventListener("abort", () => {
          aborted = true;
          rej(new Error("abortado"));
        });
      })) as unknown as typeof fetch;
    const t = createEmailTransportFromEnv({ ...ENV, EMAIL_TIMEOUT_MS: "30" }, { fetch: hang });
    await expect(t.send({ to: "a@b.test", subject: "s", text: "x" })).rejects.toBeInstanceOf(EmailTimeoutError);
    expect(aborted).toBe(true);
  });

  it("EMAIL_TIMEOUT_MS inválido é recusado; padrão é finito", () => {
    expect(() => createEmailTransportFromEnv({ ...ENV, EMAIL_TIMEOUT_MS: "0" })).toThrow(EmailConfigError);
    expect(() => createEmailTransportFromEnv({ ...ENV, EMAIL_TIMEOUT_MS: "abc" })).toThrow(EmailConfigError);
    expect(createEmailTransportFromEnv(ENV).timeout).toBe(10_000);
  });

  it("chave nunca aparece em erro de HTTP, rede ou corpo ecoado", async () => {
    const echo = (async () => ({
      ok: false,
      status: 401,
      text: async () => `invalid key ${KEY}`,
    })) as unknown as typeof fetch;
    const t = createEmailTransportFromEnv(ENV, { fetch: echo });
    const err = await t.send({ to: "a@b.test", subject: "s", text: "x" }).catch((e) => e);
    expect(String(err)).not.toContain(KEY);
    expect(JSON.stringify(err, Object.getOwnPropertyNames(err))).not.toContain(KEY);
  });

  it("não expõe a chave por inspeção/serialização do transporte", () => {
    const t = createEmailTransportFromEnv(ENV, { fetch: okFetch([]) });
    expect(JSON.stringify(t)).not.toContain(KEY);
    expect(String(Object.values(t as unknown as object))).not.toContain(KEY);
  });

  it("ligado ao AlertService: alerta sai pelo transporte HTTP injetado (nunca rede real)", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const transport = createEmailTransportFromEnv(ENV, { fetch: okFetch(calls) });
    const alerts = createAlertService({ transport, to: "ops@example.test", heartbeatThresholdMs: 180_000 });
    const r = await alerts.checkHeartbeat(0, 181_000);
    expect(r.sent).toBe(true);
    expect(calls).toHaveLength(1);
    expect(String(JSON.parse(String(calls[0]!.init.body)).subject)).toContain("3 min");
  });
});
