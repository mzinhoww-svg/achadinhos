import { type Db, tabelas as t } from "@achadinhos/db";
import { sql } from "drizzle-orm";
import type { Config } from "./config.js";
import { gerarHashSenha } from "./senha.js";

/**
 * Cria o primeiro admin quando a tabela está vazia e ADMIN_EMAIL + ADMIN_SENHA_INICIAL existem.
 * Depois do primeiro login, apague ADMIN_SENHA_INICIAL das variáveis da Vertra: ela não é usada de novo.
 */
export async function semearAdmin(
  db: Db,
  c: Config,
  log: { info: (m: string) => void; warn: (m: string) => void },
) {
  const [linha] = await db.select({ n: sql<number>`count(*)::int` }).from(t.admins);
  if ((linha?.n ?? 0) > 0) {
    if (c.ADMIN_SENHA_INICIAL)
      log.warn("ADMIN_SENHA_INICIAL não é mais usada (o admin já existe). Apague-a das variáveis da Vertra.");
    return;
  }
  if (!c.ADMIN_EMAIL || !c.ADMIN_SENHA_INICIAL) {
    log.warn(
      "Nenhum admin cadastrado. Defina ADMIN_EMAIL e ADMIN_SENHA_INICIAL nas variáveis do worker e reinicie.",
    );
    return;
  }
  await db.insert(t.admins).values({
    email: c.ADMIN_EMAIL.toLowerCase(),
    nome: c.ADMIN_NOME,
    senhaHash: await gerarHashSenha(c.ADMIN_SENHA_INICIAL),
  });
  await db
    .insert(t.auditoria)
    .values({ ator: "seed", acao: "admin.criado", alvo: c.ADMIN_EMAIL.toLowerCase() });
  log.info("Admin inicial criado.");
}
