import type { Session, SessionProvider } from "../session";
import { call, type RpcFn } from "./rpc";

/** O que usamos do `supabase.auth`. `getUser` valida o JWT no Auth server (`getSession` só lê o cookie). */
export interface AuthLike {
  getUser(): Promise<{ data: { user: { id: string } | null }; error: unknown }>;
}

export function createSupabaseSessions(auth: AuthLike, rpc: RpcFn): SessionProvider {
  let cached: Promise<Session | null> | undefined;
  return {
    current() {
      return (cached ??= (async (): Promise<Session | null> => {
        const { data, error } = await auth.getUser();
        if (error || !data.user) return null;
        // a conta é derivada de auth.uid() no banco; nunca de cookie, header ou corpo
        const accountId = await call<string>(rpc, "web_account");
        return { accountId, userId: data.user.id };
      })());
    },
  };
}
