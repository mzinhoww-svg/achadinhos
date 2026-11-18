import { z } from "zod";

const esquema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(80),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().url({ message: "DATABASE_URL ausente ou inválida" }),
  /** verificar (padrão): TLS verificando o certificado; sem-verificacao: TLS sem verificar; desligado: sem TLS (só local). */
  DATABASE_SSL: z.enum(["verificar", "sem-verificacao", "desligado"]).default("verificar"),
  /** Certificado da CA do banco (PEM), quando o provedor usa CA própria. */
  DATABASE_CA: z.string().optional(),
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
});

export type Config = z.infer<typeof esquema>;

export function lerConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const r = esquema.safeParse(Object.fromEntries(Object.entries(env).filter(([, v]) => v !== "")));
  if (!r.success) {
    const faltas = r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Configuração inválida: ${faltas}`);
  }
  return r.data;
}

export function opcoesSsl(c: Pick<Config, "DATABASE_SSL" | "DATABASE_CA">) {
  if (c.DATABASE_SSL === "desligado") return false;
  if (c.DATABASE_SSL === "sem-verificacao") return { rejectUnauthorized: false };
  return c.DATABASE_CA ? { rejectUnauthorized: true, ca: c.DATABASE_CA } : { rejectUnauthorized: true };
}
