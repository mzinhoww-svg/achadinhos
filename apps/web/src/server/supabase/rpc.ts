/**
 * Superfície mínima do cliente Supabase que os adaptadores usam: só `rpc`.
 * Toda leitura/escrita do painel é uma função `web_*` (supabase/migrations/…_t8_web_adapters.sql):
 * a conta vem de auth.uid() no banco e a RLS vale; o cliente nunca informa `account_id`.
 */
export interface RpcError {
  message: string;
  code?: string;
}
export type RpcFn = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: RpcError | null }>;

/** Erro de banco. A mensagem do Postgres pode citar valores: nunca é mostrada ao usuário (`guarded` a oculta). */
export class DbError extends Error {
  constructor(
    readonly fn: string,
    readonly pgMessage: string,
    readonly code?: string,
  ) {
    super(`db:${fn}`);
  }
}

export async function call<T>(rpc: RpcFn, fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpc(fn, args);
  if (error) throw new DbError(fn, error.message, error.code);
  return data as T;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string) => UUID.test(v);
