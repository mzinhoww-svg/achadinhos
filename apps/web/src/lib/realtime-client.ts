import type { RealtimeClientLike } from "./realtime";

/**
 * Cliente Realtime do navegador (anon key + JWT do usuário, para o RLS valer). Enquanto o Supabase Auth não
 * estiver ligado na web (T8-01 usa sessão simulada), devolve `null` e a tela cai para releitura periódica.
 * Ligar: `createClient(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY)` + `realtime.setAuth(accessToken)`.
 */
export function getRealtimeClient(): RealtimeClientLike | null {
  return null;
}
