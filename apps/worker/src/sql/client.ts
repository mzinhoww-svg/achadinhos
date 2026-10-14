/**
 * Fronteira mínima com o Postgres. O worker usa `pg` em produção (pg-client.ts); os testes usam
 * PGlite. Os adaptadores só conhecem estas interfaces, então o mesmo SQL roda nos dois.
 */
export interface SqlRunner {
  query<R extends object = Record<string, unknown>>(text: string, params?: readonly unknown[]): Promise<{ rows: R[] }>;
}

export interface SqlClient extends SqlRunner {
  /** BEGIN/COMMIT; qualquer exceção (inclusive de `fn`) faz ROLLBACK e é relançada. */
  transaction<T>(fn: (tx: SqlRunner) => Promise<T>): Promise<T>;
}
