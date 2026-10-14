import { describe, it, expect } from "vitest";
import { FetchTelegramTransport } from "../src/transport";
import { TelegramTimeoutError } from "../src/errors";

describe("FetchTelegramTransport", () => {
  it("posts to correct URL and returns parsed body", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fakeFetch = (async (url: any, init?: any) => {
      calls.push({ url: String(url), init: init as RequestInit });
      return new Response(JSON.stringify({ ok: true, result: { id: 1, is_bot: true, first_name: "bot" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const t = new FetchTelegramTransport("SECRET_TOKEN", { fetch: fakeFetch, baseUrl: "https://example.test" });
    const res = await t.call("getMe", {});
    expect(res.ok).toBe(true);
    expect(calls[0].url).toBe("https://example.test/botSECRET_TOKEN/getMe");
    const parsed = JSON.parse(String(calls[0].init.body));
    expect(parsed).toEqual({});
  });

  it("does not throw on 429, returns rate limit payload", async () => {
    const fakeFetch = (async () =>
      new Response(JSON.stringify({ ok: false, error_code: 429, description: "Too Many Requests: retry after 3", parameters: { retry_after: 3 } }), {
        status: 429,
      })) as typeof fetch;
    const t = new FetchTelegramTransport("tok", { fetch: fakeFetch });
    const res = await t.call("sendMessage", {});
    expect(res.ok).toBe(false);
    expect(res.error_code).toBe(429);
    expect(res.parameters?.retry_after).toBe(3);
  });

  it("throws when token missing", () => {
    expect(() => new FetchTelegramTransport("")).toThrow();
  });
});
describe("FetchTelegramTransport timeout and redaction", () => {
  it("throws TelegramTimeoutError when fetch never responds", async () => {
    const hangingFetch = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;
    const t = new FetchTelegramTransport("tok", { fetch: hangingFetch, timeoutMs: 20 });
    const start = Date.now();
    await expect(t.call("getMe", {})).rejects.toBeInstanceOf(TelegramTimeoutError);
    expect(Date.now() - start).toBeLessThan(200);
  });

  it("redacts token from network error message", async () => {
    const failingFetch = (async () => {
      throw new Error("request to https://api.telegram.org/bot123:SECRET/getMe failed");
    }) as unknown as typeof fetch;
    const t = new FetchTelegramTransport("123:SECRET", { fetch: failingFetch, timeoutMs: 20 });
    try {
      await t.call("getMe", {});
    } catch (e) {
      expect(String(e)).not.toContain("123:SECRET");
      expect(e).not.toBeInstanceOf(TelegramTimeoutError);
    }
  });

  it("returns parsed body on non-JSON http error", async () => {
    const fakeFetch = (async () =>
      new Response("not json", { status: 500 })) as unknown as typeof fetch;
    const t = new FetchTelegramTransport("tok", { fetch: fakeFetch, timeoutMs: 20 });
    const res = await t.call("getMe", {});
    expect(res.ok).toBe(false);
    expect(res.description).toContain("not json");
  });
});
