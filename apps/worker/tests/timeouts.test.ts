import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ShopeeClient, ShopeeTimeoutError } from "@achadinhos/shopee";
import { FetchTelegramTransport, TelegramTimeoutError } from "@achadinhos/telegram";
import { downloadProductImage, ImageRejectedError } from "../src/image.js";
import { StepTimeoutError, withTimeout } from "../src/timeouts.js";
import { startStalledServer } from "./helpers.js";

describe("timeout cobre a leitura do corpo em cada cliente", () => {
  let stalled: Awaited<ReturnType<typeof startStalledServer>>;
  beforeEach(async () => {
    stalled = await startStalledServer();
  });
  afterEach(async () => {
    await stalled.close();
  });

  it("Shopee: corpo estancado vira ShopeeTimeoutError", async () => {
    const client = new ShopeeClient({ appId: "a", secret: "s" }, { endpoint: stalled.url, timeoutMs: 150 });
    const t0 = Date.now();
    await expect(client.generateShortLink({ originUrl: "https://shopee.com.br/x", subIds: [] })).rejects.toBeInstanceOf(
      ShopeeTimeoutError,
    );
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it("Shopee: fetch que ignora o signal e estanca o corpo também expira", async () => {
    const hanging = (async () =>
      new Response(new ReadableStream({ start() {} }), { status: 200 })) as unknown as typeof fetch;
    const client = new ShopeeClient({ appId: "a", secret: "s" }, { fetch: hanging, timeoutMs: 150 });
    await expect(client.generateShortLink({ originUrl: "https://shopee.com.br/x", subIds: [] })).rejects.toBeInstanceOf(
      ShopeeTimeoutError,
    );
  });

  it("Telegram: corpo estancado vira TelegramTimeoutError", async () => {
    const transport = new FetchTelegramTransport("123:abc", { baseUrl: stalled.url, timeoutMs: 150 });
    await expect(transport.call("sendPhoto", { chat_id: 1 })).rejects.toBeInstanceOf(TelegramTimeoutError);
  });

  it("download de imagem: corpo estancado vira ImageRejectedError(timeout)", async () => {
    const viaStalled = ((_u: string, init?: RequestInit) => fetch(`${stalled.url}/image`, init)) as unknown as typeof fetch;
    await expect(
      downloadProductImage("https://cf.shopee.com.br/file/x", {
        allowedHosts: ["cf.shopee.com.br"],
        maxBytes: 1000,
        timeoutMs: 150,
        resolveHost: async () => ["93.184.216.34"],
        fetch: viaStalled,
      }),
    ).rejects.toMatchObject({ code: "timeout" });
  });

  it("withTimeout rejeita com StepTimeoutError nomeando a etapa", async () => {
    await expect(withTimeout(new Promise(() => {}), 50, "render")).rejects.toMatchObject({
      name: "StepTimeoutError",
      step: "render",
    });
    expect(new StepTimeoutError("x")).toBeInstanceOf(Error);
    expect(new ImageRejectedError("host")).toBeInstanceOf(Error);
  });
});
