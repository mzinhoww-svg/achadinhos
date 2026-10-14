import { describe, expect, it } from "vitest";
import { Secret } from "../src/config.js";
import { assertWorkerRole, createPgClient, InsecureConnectionError, resolveTls } from "../src/sql/pg-client.js";

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

describe("TLS obrigatório fora de localhost (QA #37, bloqueante 1)", () => {
  const remote = "postgresql://u:SENHA-NAO-REAL@aws-0-sa-east-1.pooler.supabase.com:6543/postgres";

  it("recusa URL remota sem sslmode, sem vazar a URL", () => {
    let err: unknown;
    try {
      resolveTls(remote);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(InsecureConnectionError);
    expect(String((err as Error).message)).not.toContain("SENHA-NAO-REAL");
    expect(String((err as Error).message)).not.toContain("pooler.supabase.com");
  });

  it.each(["disable", "allow", "prefer"])("recusa sslmode=%s em host remoto", (m) => {
    expect(() => resolveTls(`${remote}?sslmode=${m}`)).toThrow(InsecureConnectionError);
  });

  it.each(["require", "verify-ca", "verify-full"])("aceita sslmode=%s e SEMPRE verifica o certificado", (m) => {
    const r = resolveTls(`${remote}?sslmode=${m}`);
    expect(r.ssl).toEqual({ rejectUnauthorized: true });
    // sslmode sai da string: o pg não pode rebaixar a verificação
    expect(r.connectionString).not.toContain("sslmode");
  });

  it("usa a CA informada (CA do Supabase)", () => {
    const r = resolveTls(`${remote}?sslmode=verify-full`, { caCert: "-----BEGIN CERTIFICATE-----x" });
    expect(r.ssl).toEqual({ rejectUnauthorized: true, ca: "-----BEGIN CERTIFICATE-----x" });
  });

  it.each(["localhost", "127.0.0.1", "[::1]"])("loopback %s dispensa TLS", (h) => {
    expect(resolveTls(`postgresql://u:p@${h}:5432/db`).ssl).toBe(false);
  });

  it("host que só começa com 'localhost' não é loopback", () => {
    expect(() => resolveTls("postgresql://u:p@localhost.evil.com/db")).toThrow(InsecureConnectionError);
  });

  it("createPgClient recusa a URL insegura na construção", () => {
    expect(() => createPgClient(new Secret(remote))).toThrow(InsecureConnectionError);
  });
});

describe("assertWorkerRole (QA #37, bloqueante 2)", () => {
  const runner = (row: Record<string, unknown>) => ({ query: async () => ({ rows: [row] as never[] }) });
  const row = (o: Record<string, unknown>) => ({ session_user: "achadinhos_worker", current_user: "service_role", is_super: false, owns_sends: false, ...o });

  it.each([
    [row({ session_user: "postgres", current_user: "postgres", owns_sends: true })],
    [row({ session_user: "supabase_admin", current_user: "supabase_admin", is_super: true })],
    [row({ session_user: "alguem", is_super: true })],
    [row({ session_user: "alguem", owns_sends: true })],
  ])("falha quando a conexão é dono/superuser: %j", async (r) => {
    await expect(assertWorkerRole(runner(r))).rejects.toThrow(/role/);
  });

  it("a mensagem de erro não carrega o nome do usuário", async () => {
    await expect(assertWorkerRole(runner(row({ session_user: "segredo_user", is_super: true })))).rejects.not.toThrow(/segredo_user/);
  });

  it("aceita a role de login do worker", async () => {
    await expect(assertWorkerRole(runner(row({})))).resolves.toBe("achadinhos_worker");
  });
});
