import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Db } from "./cliente.js";

/** Pasta dos .sql gerados pelo drizzle-kit. O pacote do worker copia esta pasta para o deploy. */
export const PASTA_MIGRACOES = fileURLToPath(new URL("../drizzle", import.meta.url));

/** Aplica as migrações pendentes. O controle fica em achadinhos.__migracoes, dentro do próprio schema. */
export async function migrar(db: Db, pasta: string = PASTA_MIGRACOES): Promise<void> {
  await migrate(db, {
    migrationsFolder: pasta,
    migrationsSchema: "achadinhos",
    migrationsTable: "__migracoes",
  });
}
