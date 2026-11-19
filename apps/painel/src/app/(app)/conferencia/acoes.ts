"use server";

import { revalidatePath } from "next/cache";
import { exigirSessao } from "@/lib/auth";
import { worker } from "@/lib/worker";

/** Pede ao worker um lote de peças do nicho piloto; ele renderiza em segundo plano. */
export async function gerarLote(form: FormData) {
  await exigirSessao();
  const limite = Math.min(20, Math.max(1, Number(form.get("limite")) || 10));
  const forcarFallbackEm = Math.min(limite, Math.max(0, Number(form.get("fallback")) || 0));
  await worker.gerarLoteArte({ limite, forcarFallbackEm });
  revalidatePath("/conferencia");
}
