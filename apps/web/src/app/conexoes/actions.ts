"use server";

import { revalidatePath } from "next/cache";
import { container } from "@/server/context";
import { saveShopee, saveTelegram, setGroupActive } from "@/server/connections";
import { guarded, type ActionResult } from "@/server/session";

export type FormState = ActionResult<{ summary: string }> | null;

async function guard<I, O>(fn: (d: { repo: never; vault: never; telegram: never } | Parameters<typeof saveShopee>[0], s: Parameters<typeof saveShopee>[1], i: I) => Promise<O>) {
  const c = await container();
  const d = { repo: c.connections, vault: c.vault, telegram: c.telegram };
  return guarded<I, O>(c.sessions, (s, i) => fn(d, s, i));
}

const fields = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([k]) => !k.startsWith("$ACTION")));

export async function saveShopeeAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const run = await guard<FormData, { summary: string }>(async (d, s, f) => {
    const i = fields(f);
    await saveShopee(d as Parameters<typeof saveShopee>[0], s, { appId: i.appId, secret: i.secret });
    return { summary: "Credencial enviada ao cofre. A validação roda em instantes." };
  });
  const r = await run(fd);
  if (r.ok) revalidatePath("/conexoes");
  return r;
}

export async function saveTelegramAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const run = await guard<FormData, { summary: string }>(async (d, s, f) => {
    const out = await saveTelegram(d as Parameters<typeof saveTelegram>[0], s, { token: fields(f).token });
    return { summary: `${out.botName} conectado. ${out.groups.length} grupo(s) encontrado(s).` };
  });
  const r = await run(fd);
  if (r.ok) revalidatePath("/conexoes");
  return r;
}

export async function setGroupActiveAction(groupId: string, active: boolean): Promise<{ ok: boolean; message?: string }> {
  const run = await guard<{ groupId: string; active: boolean }, unknown>((d, s, i) => setGroupActive(d as Parameters<typeof setGroupActive>[0], s, i));
  const r = await run({ groupId, active });
  if (r.ok) revalidatePath("/conexoes");
  return r.ok ? { ok: true } : { ok: false, message: r.message };
}
