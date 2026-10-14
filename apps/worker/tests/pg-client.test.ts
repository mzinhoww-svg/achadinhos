import { describe, expect, it } from "vitest";
import { Secret } from "../src/config.js";
import { createPgClient } from "../src/sql/pg-client.js";

describe("createPgClient", () => {
  it("conexão impossível falha dentro do timeout e o erro não carrega a URL/senha", async () => {
    const url = "postgresql://worker:SENHA-NAO-REAL-123@127.0.0.1:1/postgres";
    const c = createPgClient(new Secret(url), { connectTimeoutMs: 500, queryTimeoutMs: 500 });
    const t0 = Date.now();
    const err = await c.query("select 1").then(
      () => null,
      (e: unknown) => e as Error,
    );
    await c.close();
    expect(err).toBeInstanceOf(Error);
    expect(Date.now() - t0).toBeLessThan(5_000);
    expect(JSON.stringify({ m: err!.message, s: err!.stack })).not.toContain("SENHA-NAO-REAL-123");
  });

  it("transaction com conexão impossível rejeita sem ficar pendurada", async () => {
    const c = createPgClient(new Secret("postgresql://u:p@127.0.0.1:1/db"), { connectTimeoutMs: 500 });
    await expect(c.transaction(async () => 1)).rejects.toBeInstanceOf(Error);
    await c.close();
  });
});
