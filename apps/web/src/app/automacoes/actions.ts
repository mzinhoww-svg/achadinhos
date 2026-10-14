"use server";

import { revalidatePath } from "next/cache";
import { createAutomation, deleteAutomation, updateAutomation } from "@/server/automations";
import { container } from "@/server/context";
import { guarded, type ActionResult } from "@/server/session";

export type AutomationFormState = ActionResult<{ id: string }> | null;

/** Converte o FormData do navegador no objeto que o zod valida. Nenhum campo de conta é aceito. */
function toInput(fd: FormData) {
  const num = (k: string) => {
    const v = String(fd.get(k) ?? "").trim().replace(",", ".");
    return v === "" ? undefined : Number(v);
  };
  const filters: Record<string, unknown> = {};
  const category = String(fd.get("category") ?? "");
  if (category) filters.category = category;
  for (const [form, key] of [["maxPrice", "priceMax"], ["minDiscount", "minDiscount"], ["minCommission", "minCommission"], ["minRating", "minRating"], ["minSales", "minSales"]] as const) {
    const n = num(form);
    if (n !== undefined && Number.isFinite(n)) filters[key] = n;
  }
  return {
    id: fd.get("id") ? String(fd.get("id")) : undefined,
    name: String(fd.get("name") ?? ""),
    days: fd.getAll("days").map((d) => Number(d)),
    windowStart: String(fd.get("windowStart") ?? ""),
    windowEnd: String(fd.get("windowEnd") ?? ""),
    frequencyMin: Number(fd.get("frequencyMin") ?? 0),
    filters,
    header: String(fd.get("header") ?? "") || null,
    footer: String(fd.get("footer") ?? "") || null,
    groupIds: fd.getAll("groupIds").map(String),
  };
}

async function guard<I, O>(fn: (d: { automations: never; connections: never }, s: { accountId: string; userId: string }, i: I) => Promise<O>) {
  const c = await container();
  return guarded<I, O>(c.sessions, (s, i) => fn({ automations: c.automations, connections: c.connections } as never, s, i));
}

export async function saveAutomationAction(_prev: AutomationFormState, fd: FormData): Promise<AutomationFormState> {
  // Conta vem da sessão; se o formulário trouxer account_id, `guarded` recusa antes de qualquer coisa.
  if ([...fd.keys()].some((k) => /^(account|tenant)_?id$/i.test(k))) {
    return { ok: false, code: "forbidden", message: "A conta é definida pela sessão." };
  }
  const input = toInput(fd);
  const run = await guard<typeof input, { id: string }>(async (d, s, i) => {
    const deps = d as unknown as Parameters<typeof createAutomation>[0];
    const rec = i.id ? await updateAutomation(deps, s, i) : await createAutomation(deps, s, i);
    return { id: rec.id };
  });
  const r = await run(input);
  if (r.ok) {
    revalidatePath("/automacoes");
    revalidatePath("/painel");
  }
  return r;
}

export async function deleteAutomationAction(id: string): Promise<{ ok: boolean; message?: string }> {
  const run = await guard<{ id: string }, unknown>((d, s, i) => deleteAutomation(d as unknown as Parameters<typeof deleteAutomation>[0], s, i));
  const r = await run({ id });
  if (r.ok) revalidatePath("/automacoes");
  return r.ok ? { ok: true } : { ok: false, message: r.message };
}
