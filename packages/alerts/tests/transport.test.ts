import { describe, it, expect } from "vitest";
import { HttpEmailTransport, InMemoryEmailTransport } from "../src/transport";
import { EmailTimeoutError } from "../src/errors";

describe("http email transport", () => {
  it("times out reading body", async () => {
    // ensure body read hangs
    const fetchFn = (async () => ({
      ok: true,
      status: 200,
      text: async () => new Promise<string>(() => {}),
    })) as unknown as typeof fetch;
    const t = new HttpEmailTransport("secret", { fetch: fetchFn, timeoutMs: 20 });
    await expect(t.send({ to: "a@b.com", subject: "s", text: "x" })).rejects.toBeInstanceOf(EmailTimeoutError);
  });

  it("does not leak key in error", async () => {
    const failingFetch = (async () => { throw new Error("network: secret-key"); }) as unknown as typeof fetch;
    const t = new HttpEmailTransport("secret-key", { fetch: failingFetch, timeoutMs: 20, endpoint: "https://x" });
    try {
      await t.send({ to: "a@b.com", subject: "s", text: "x" });
    } catch (e) {
      expect(String(e)).not.toContain("secret-key");
    }
  });

  it("in-memory captures", async () => {
    const t = new InMemoryEmailTransport();
    await t.send({ to: "a@b.com", subject: "s", text: "x" });
    expect(t.emails).toHaveLength(1);
    expect(t.getSentMessages()).toHaveLength(1);
  });
});