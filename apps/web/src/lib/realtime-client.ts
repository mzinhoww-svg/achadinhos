import { createClient } from "@supabase/supabase-js";
import type { RealtimeClientLike } from "./realtime";

export interface RealtimeConfig {
  url: string;
  anonKey: string;
}

export interface RealtimeEnv {
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
}

/** Papel declarado no JWT, sem validar assinatura (só para recusar a service_role no navegador). */
function jwtRole(token: string): string | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const json = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/"))) as { role?: unknown };
    return typeof json.role === "string" ? json.role : null;
  } catch {
    return null;
  }
}

function isAllowedUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol === "https:") return true;
    return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

/**
 * URL e anon key públicas por env. Devolve `null` (→ polling) se faltar algo, se a URL não for https
 * (exceto localhost) ou se a chave for a service_role, que nunca pode chegar ao navegador.
 */
export function readRealtimeConfig(env: RealtimeEnv): RealtimeConfig | null {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey || !isAllowedUrl(url)) return null;
  if (jwtRole(anonKey) === "service_role") return null;
  return { url, anonKey };
}

/** Cliente do SDK autenticado com o JWT do usuário, para o Realtime aplicar o RLS dele. Não abre conexão até `subscribe`. */
export function createRealtimeClient(config: RealtimeConfig, accessToken: string): RealtimeClientLike {
  const client = createClient(config.url, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    realtime: { params: { eventsPerSecond: 5 } },
  });
  client.realtime.setAuth(accessToken);
  return client as unknown as RealtimeClientLike;
}

type Factory = (url: string, anonKey: string, options: { auth: Record<string, unknown>; realtime: Record<string, unknown> }) => {
  channel: unknown;
  removeChannel: unknown;
  realtime: { setAuth(token: string): unknown };
};

export interface GetRealtimeClientOptions {
  /** JWT do usuário logado (Supabase Auth). Sem ele o anon não passa no RLS de `sends`: fica o polling. */
  accessToken: string | null | undefined;
  /** Injetáveis para teste. Em produção o env é lido de `NEXT_PUBLIC_*` e o SDK é o real. */
  env?: RealtimeEnv;
  create?: Factory;
}

/**
 * Cliente Realtime do navegador, ou `null` quando não há como assinar com segurança (sem env, sem JWT do
 * usuário ou falha ao criar). `null` nunca é erro: a tela segue atualizando por releitura periódica.
 */
export function getRealtimeClient(opts: GetRealtimeClientOptions): RealtimeClientLike | null {
  const token = opts.accessToken?.trim();
  if (!token) return null;
  // Referências literais: o Next só inlina `process.env.NEXT_PUBLIC_*` assim, no bundle do navegador.
  const env =
    opts.env ??
    ({
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    } satisfies RealtimeEnv);
  const config = readRealtimeConfig(env);
  if (!config) return null;
  try {
    if (opts.create) {
      const c = opts.create(config.url, config.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        realtime: { params: { eventsPerSecond: 5 } },
      });
      c.realtime.setAuth(token);
      return c as unknown as RealtimeClientLike;
    }
    return createRealtimeClient(config, token);
  } catch {
    return null;
  }
}
