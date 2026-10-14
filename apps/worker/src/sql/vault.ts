import type { SecretVault } from "../validation/types.js";
import type { SqlRunner } from "./client.js";

/**
 * Leitura do Vault pelo worker (decisão 003). Usa a RPC `worker_read_secret` (EXECUTE só para
 * service_role); o painel nunca lê o valor de volta. O retorno nunca deve ser logado.
 */
export class PgSecretVault implements SecretVault {
  constructor(private readonly db: SqlRunner) {}

  async read(secretId: string): Promise<string | null> {
    const r = await this.db.query<{ v: string | null }>("select public.worker_read_secret($1::uuid) as v", [secretId]);
    return r.rows[0]?.v ?? null;
  }
}
