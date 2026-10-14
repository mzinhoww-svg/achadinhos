import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config.js";

const valid = {
  DATABASE_URL: "postgres://worker:s3cr3t-pw@db.example.com:5432/postgres",
};

describe("loadConfig", () => {
  it("aplica defaults seguros quando só o obrigatório está presente", () => {
    const c = loadConfig(valid);
    expect(c.tickIntervalMs).toBe(60_000);
    expect(c.leaseMs).toBe(120_000);
    expect(c.externalTimeoutMs).toBeLessThan(c.leaseMs);
    expect(c.heartbeatStaleMs).toBe(180_000);
  });

  it("falha fechada sem DATABASE_URL", () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
  });

  it("recusa timeout externo >= lease (lease não pode expirar em operação normal)", () => {
    expect(() =>
      loadConfig({ ...valid, CLAIM_LEASE_MS: "30000", EXTERNAL_TIMEOUT_MS: "30000" }),
    ).toThrow(ConfigError);
  });

  it("recusa número inválido em vez de cair no default", () => {
    expect(() => loadConfig({ ...valid, TICK_INTERVAL_MS: "abc" })).toThrow(ConfigError);
    expect(() => loadConfig({ ...valid, TICK_INTERVAL_MS: "-1" })).toThrow(ConfigError);
  });

  it("recusa endpoint Shopee não https", () => {
    expect(() => loadConfig({ ...valid, SHOPEE_ENDPOINT: "http://evil.example/graphql" })).toThrow(
      ConfigError,
    );
  });

  it("o erro cita só nomes de variáveis, nunca valores", () => {
    const secret = "postgres://worker:TOPSECRET@x";
    try {
      loadConfig({ DATABASE_URL: "nao-e-url-TOPSECRET", TICK_INTERVAL_MS: secret });
      expect.unreachable();
    } catch (e) {
      const text = String(e) + JSON.stringify(e) + (e as Error).message;
      expect(text).not.toContain("TOPSECRET");
      expect(text).toContain("TICK_INTERVAL_MS");
    }
  });

  it("não expõe a URL do banco em JSON.stringify/inspect da config", async () => {
    const { inspect } = await import("node:util");
    const c = loadConfig(valid);
    expect(JSON.stringify(c)).not.toContain("s3cr3t-pw");
    expect(inspect(c, { depth: 5 })).not.toContain("s3cr3t-pw");
    expect(c.databaseUrl.reveal()).toBe(valid.DATABASE_URL);
  });
});

describe("loadConfig — endurecimento", () => {
  const base = { DATABASE_URL: "postgres://worker:pw@db.example.com:5432/postgres" };
  it("DATABASE_URL só postgres/postgresql", () => {
    expect(() => loadConfig({ DATABASE_URL: "https://db.example.com/x" })).toThrow(ConfigError);
    expect(() => loadConfig({ DATABASE_URL: "postgresql://u:p@h/db" })).not.toThrow();
  });
  it("endpoint recusa userinfo e IP literal/loopback", () => {
    for (const u of ["https://user:pw@evil.example/graphql", "https://127.0.0.1/graphql", "https://[::1]/graphql", "https://localhost/graphql"]) {
      expect(() => loadConfig({ ...base, SHOPEE_ENDPOINT: u })).toThrow(ConfigError);
    }
  });
  it("limites: tick ≥ 5 s, heartbeat ≥ 2× tick, lease ≥ timeout + margem", () => {
    expect(() => loadConfig({ ...base, TICK_INTERVAL_MS: "1" })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, TICK_INTERVAL_MS: "99999999999999999999" })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, HEARTBEAT_STALE_MS: "1000" })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, CLAIM_LEASE_MS: "10000", EXTERNAL_TIMEOUT_MS: "9000" })).toThrow(ConfigError);
  });
});
