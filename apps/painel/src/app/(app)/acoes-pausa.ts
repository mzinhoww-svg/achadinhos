"use server";

import { revalidatePath } from "next/cache";
import { exigirSessao } from "@/lib/auth";
import { worker } from "@/lib/worker";

/** PAUSAR / RETOMAR pelo painel: grava no worker, que confere a pausa antes de cada envio. */
export async function alternarPausa(pausar: boolean) {
  const s = await exigirSessao();
  await worker.definirPausa(
    pausar,
    pausar ? "botão Pausar tudo no painel" : "botão Retomar no painel",
    `${s.nome} (painel)`,
  );
  revalidatePath("/", "layout");
}
