import type { ConnectionOptions } from "node:tls";
import { z } from "zod";

const pemBase64 = z
  .string()
  .transform((s) => Buffer.from(s.trim(), "base64").toString("utf8"))
  .refine((s) => s.includes("-----BEGIN "), "não é um PEM em base64")
  .optional();

const esquema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(80),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().url({ message: "DATABASE_URL ausente ou inválida" }),
  /**
   * verify-ca (padrão): TLS conferindo a CA, sem conferir o nome do host (o certificado do Postgres da
   * Vertra é emitido para "postgres"). verify-full: confere também o nome. no-verify: TLS sem conferir.
   * off: sem TLS (só para o banco local de testes).
   */
  DB_SSL_MODO: z.enum(["verify-ca", "verify-full", "no-verify", "off"]).default("verify-ca"),
  /** CA, certificado e chave de cliente (mTLS) em PEM codificado em base64, como nas outras apps da Vertra. */
  DB_SSL_CA_B64: pemBase64,
  DB_SSL_CERT_B64: pemBase64,
  DB_SSL_KEY_B64: pemBase64,
  SERVICE_TOKEN: z.string().min(32, "SERVICE_TOKEN precisa de pelo menos 32 caracteres"),
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_NOME: z.string().default("Aurimar"),
  ADMIN_SENHA_INICIAL: z
    .string()
    .min(12, "ADMIN_SENHA_INICIAL precisa de pelo menos 12 caracteres")
    .optional(),
  /** Pasta das migrações; no deploy fica ao lado do worker.mjs. */
  MIGRACOES_DIR: z.string().optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  /** shopee (piloto) ou fake (ensaio e testes, sem a API real). */
  MARKETPLACE: z.enum(["shopee", "fake"]).default("shopee"),
  SHOPEE_APP_ID: z.string().regex(/^\d+$/, "SHOPEE_APP_ID tem só dígitos").optional(),
  SHOPEE_SECRET: z.string().min(8).optional(),
  /** Só para apontar a um servidor simulado; a validação aceita *.shopee.com.br e loopback. */
  SHOPEE_ENDPOINT: z.string().url().optional(),
  /** Chamadas por minuto à Open API (limite real não publicado; 30/min = 1800/h fica abaixo de 2000/h). */
  SHOPEE_POR_MINUTO: z.coerce.number().int().min(1).max(600).default(30),
  /** Agenda do Monitor (cron, fuso de São Paulo). Padrão: a cada 2 horas. */
  MONITOR_CRON: z.string().default("0 */2 * * *"),
  MONITOR_MAX_DETALHES: z.coerce.number().int().min(0).max(2000).default(100),
  /** Histórico mínimo para virar oferta. */
  HISTORICO_MIN_AMOSTRAS: z.coerce.number().int().min(1).max(500).default(4),
  HISTORICO_MIN_DIAS: z.coerce.number().min(0).max(30).default(3),
});

export type Config = z.infer<typeof esquema>;

export const VALOR_PENDENTE = "PENDENTE";

export function lerConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // "PENDENTE" é o marcador das variáveis criadas na Vertra à espera do valor (ela não aceita vazio).
  const limpo = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== "" && v !== VALOR_PENDENTE));
  const r = esquema.safeParse(limpo);
  if (!r.success) {
    // Só o nome da variável e o problema: nunca o valor.
    const faltas = r.error.issues
      .map((i) => {
        const nome = i.path.join(".");
        return `${nome}: ${limpo[nome] === undefined ? "ausente" : i.message}`;
      })
      .join("; ");
    throw new Error(`Configuração inválida: ${faltas}`);
  }
  return r.data;
}

type ConfigSsl = Pick<Config, "DB_SSL_MODO" | "DB_SSL_CA_B64" | "DB_SSL_CERT_B64" | "DB_SSL_KEY_B64">;

export function opcoesSsl(c: ConfigSsl): ConnectionOptions | false {
  if (c.DB_SSL_MODO === "off") return false;
  const cliente =
    c.DB_SSL_CERT_B64 && c.DB_SSL_KEY_B64 ? { cert: c.DB_SSL_CERT_B64, key: c.DB_SSL_KEY_B64 } : {};
  if (c.DB_SSL_MODO === "no-verify") return { rejectUnauthorized: false, ...cliente };
  const base: ConnectionOptions = {
    rejectUnauthorized: true,
    ...cliente,
    ...(c.DB_SSL_CA_B64 ? { ca: c.DB_SSL_CA_B64 } : {}),
  };
  // verify-ca: a cadeia é conferida contra a CA, o nome do host não.
  return c.DB_SSL_MODO === "verify-ca" ? { ...base, checkServerIdentity: () => undefined } : base;
}

/**
 * Tira da URL os parâmetros de TLS (sslmode, sslrootcert...). No `pg`, eles sobrescrevem a opção `ssl`
 * passada no código; aqui quem manda é DB_SSL_MODO.
 */
export function urlSemSsl(url: string): string {
  const u = new URL(url);
  for (const p of ["sslmode", "ssl", "sslcert", "sslkey", "sslrootcert", "sslpassword", "uselibpqcompat"]) {
    u.searchParams.delete(p);
  }
  return u.toString();
}
