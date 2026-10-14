"use server";

import { container } from "@/server/context";
import { getEnvios, type EnviosView } from "@/server/envios";
import { guarded, type ActionResult } from "@/server/session";

/** Releitura para o painel ao vivo (fallback quando não há Realtime e quando chega evento de envio novo). */
export async function refreshEnviosAction(status: string, groupId: string | null): Promise<ActionResult<EnviosView>> {
  const c = await container();
  c.advanceDemo?.();
  return guarded<{ status: string; groupId: string | null }, EnviosView>(c.sessions, (s, i) => getEnvios({ sends: c.sends }, s, i))({ status, groupId });
}
