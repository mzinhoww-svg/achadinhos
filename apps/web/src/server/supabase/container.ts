import type { Container } from "../context";
import { createSupabaseRepos } from "./repos";
import type { RpcFn } from "./rpc";
import { createSupabaseSessions, type AuthLike } from "./session";

/** Sem URL/chave do Supabase: ninguém tem sessão e qualquer acesso a dados falha fechado (nunca memória). */
export const unconfiguredRpc: RpcFn = async () => ({ data: null, error: { message: "supabase_not_configured" } });
export const unconfiguredAuth: AuthLike = { getUser: async () => ({ data: { user: null }, error: { message: "supabase_not_configured" } }) };

export function buildSupabaseContainer(
  client: { auth: AuthLike; rpc: RpcFn },
  rest: Pick<Container, "telegram" | "finder" | "links">,
): Container {
  const repos = createSupabaseRepos(client.rpc);
  return { ...repos, ...rest, sessions: createSupabaseSessions(client.auth, client.rpc) };
}
