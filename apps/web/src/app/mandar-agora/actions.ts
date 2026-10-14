"use server";

import { revalidatePath } from "next/cache";
import { container } from "@/server/context";
import { previewOffer, searchOffers, sendNow, type PublicOffer, type SendNowResult } from "@/server/send-now";
import { guarded, type ActionResult } from "@/server/session";

async function run<I, O>(fn: (deps: Parameters<typeof searchOffers>[0], s: Parameters<typeof searchOffers>[1], i: I) => Promise<O>, input: I): Promise<ActionResult<O>> {
  const c = await container();
  const deps = { connections: c.connections, sends: c.sendNow, finder: c.finder, links: c.links };
  return guarded<I, O>(c.sessions, (s, i) => fn(deps, s, i))(input);
}

export async function searchOffersAction(q: string): Promise<ActionResult<PublicOffer[]>> {
  return run((d, s, i) => searchOffers(d, s, i), { q });
}

export async function previewOfferAction(itemId: string, groupIds: string[]) {
  return run((d, s, i) => previewOffer(d, s, i), { itemId, groupIds });
}

export async function sendNowAction(itemId: string, groupIds: string[]): Promise<ActionResult<SendNowResult>> {
  const r = await run((d, s, i) => sendNow(d, s, i), { itemId, groupIds });
  if (r.ok) revalidatePath("/envios");
  return r;
}
