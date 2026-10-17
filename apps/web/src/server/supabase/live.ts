import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { Container } from "../context";
import type { OfferFinder, ShortLinkGateway } from "../send-ports";
import { createTelegramGateway } from "../telegram-gateway";
import { buildSupabaseContainer, unconfiguredAuth, unconfiguredRpc } from "./container";
import type { RpcFn } from "./rpc";

/**
 * DORMENTE (T8-A) — ver docs/plans/escopo-sem-supabase-telegram.md §2 ("apps/web usa só o
 * container em memória").
 *
 * Este é o caminho "real" (Supabase Auth + RLS + Telegram), preservado no repositório mas **fora
 * do caminho ativo**: `../context.ts` monta apenas o container em memória. Reabrir quando a
 * persistência for decidida (§4 do plano).
 *
 * Segurança preservada: a `service_role` nunca entra aqui; o cliente usa só a chave pública
 * (anon) com os cookies do usuário. Sem configuração, falha fechado.
 */

/** Sem adaptador configurado nenhuma consulta à Shopee acontece (a web não lê o Secret; decisão 003 H1). */
export const offlineFinder: OfferFinder = {
  async search() { throw new Error("finder_not_configured"); },
  async byItemId() { throw new Error("finder_not_configured"); },
  async resolveShortUrl() { throw new Error("finder_not_configured"); },
};
export const offlineLinks: ShortLinkGateway = { async generate() { throw new Error("links_not_configured"); } };

/**
 * Real: Supabase Auth + RLS. Um cliente por requisição, com os cookies do usuário e só a chave
 * pública (anon); a service_role nunca entra no web. Sem configuração: falha fechado (sem sessão,
 * sem dados).
 */
export async function liveContainer(): Promise<Container> {
  const rest = { telegram: createTelegramGateway(), finder: offlineFinder, links: offlineLinks };
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return buildSupabaseContainer({ auth: unconfiguredAuth, rpc: unconfiguredRpc }, rest);
  }
  const jar = await cookies();
  const client = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll(list) {
        // Server Components não podem gravar cookie; a renovação do token acontece em actions/route handlers.
        try {
          for (const c of list) jar.set(c.name, c.value, c.options);
        } catch {
          /* noop */
        }
      },
    },
  });
  const rpc: RpcFn = (fn, args) => client.rpc(fn, args);
  return buildSupabaseContainer({ auth: client.auth, rpc }, rest);
}

export const live = cache(liveContainer);
