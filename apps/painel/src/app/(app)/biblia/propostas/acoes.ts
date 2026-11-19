"use server";

import { revalidatePath } from "next/cache";
import { exigirSessao } from "@/lib/auth";
import { worker } from "@/lib/worker";

/** O Aurimar decide pelo painel; o worker grava a nova versão da bíblia quando a proposta tem documento. */
export async function decidir(form: FormData) {
  const sessao = await exigirSessao();
  const id = Number(form.get("id"));
  const decisao = form.get("decisao") === "aprovada" ? "aprovada" : "rejeitada";
  if (!Number.isInteger(id) || id <= 0) return;
  await worker.decidirProposta(id, decisao, `${sessao.nome} (painel)`);
  revalidatePath("/biblia/propostas");
  revalidatePath("/biblia");
}
