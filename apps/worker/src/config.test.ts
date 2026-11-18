import { describe, expect, it } from "vitest";
import { lerConfig, opcoesSsl, urlSemSsl } from "./config.js";

const pem = (t: string) => Buffer.from(`-----BEGIN ${t}-----\nabc\n-----END ${t}-----\n`).toString("base64");
const base = { DATABASE_URL: "postgres://u:p@h:5432/d", SERVICE_TOKEN: "x".repeat(40) };

describe("config", () => {
  it("lê os padrões", () => {
    const c = lerConfig(base);
    expect(c.PORT).toBe(80);
    expect(c.DB_SSL_MODO).toBe("verify-ca");
    expect(() => lerConfig({})).toThrow(/DATABASE_URL: ausente/);
    expect(() => lerConfig({ ...base, SERVICE_TOKEN: "PENDENTE" })).toThrow(/SERVICE_TOKEN: ausente/);
  });
  it("aponta a variável errada sem mostrar o valor", () => {
    expect(() => lerConfig({ ...base, SERVICE_TOKEN: "segredo-curto" })).toThrow(/SERVICE_TOKEN/);
    expect(() => lerConfig({ ...base, SERVICE_TOKEN: "segredo-curto" })).not.toThrow(/segredo-curto/);
  });
  it("monta o mTLS a partir dos PEM em base64", () => {
    const c = lerConfig({
      ...base,
      DB_SSL_CA_B64: pem("CERTIFICATE"),
      DB_SSL_CERT_B64: pem("CERTIFICATE"),
      DB_SSL_KEY_B64: pem("PRIVATE KEY"),
    });
    const ssl = opcoesSsl(c);
    expect(ssl).toMatchObject({ rejectUnauthorized: true });
    if (!ssl) throw new Error("sem ssl");
    expect(ssl.ca).toContain("BEGIN CERTIFICATE");
    expect(ssl.key).toContain("BEGIN PRIVATE KEY");
    expect(ssl.checkServerIdentity?.("h", {} as never)).toBeUndefined();
    expect(opcoesSsl({ ...c, DB_SSL_MODO: "off" })).toBe(false);
    expect(opcoesSsl({ ...c, DB_SSL_MODO: "verify-full" })).not.toHaveProperty("checkServerIdentity");
  });
  it("recusa PEM inválido", () => {
    expect(() => lerConfig({ ...base, DB_SSL_CA_B64: Buffer.from("nada").toString("base64") })).toThrow(
      /DB_SSL_CA_B64/,
    );
  });
  it("tira os parâmetros de TLS da URL", () => {
    expect(urlSemSsl("postgresql://u:p@h:1/d?sslmode=verify-ca&application_name=x")).toBe(
      "postgresql://u:p@h:1/d?application_name=x",
    );
  });
});
