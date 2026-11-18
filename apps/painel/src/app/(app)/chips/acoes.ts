"use server";

import { exigirSessao } from "@/lib/auth";
import { worker } from "@/lib/worker";

export async function gerarPareamento(
  instanceId: string,
): Promise<{ url: string | null; erro: string | null }> {
  const s = await exigirSessao();
  if (!/^[a-z0-9-]{2,32}$/.test(instanceId)) return { url: null, erro: "apelido inválido" };
  try {
    const r = await worker.post<{ url: string }>(`/numeros/${instanceId}/pareamento`);
    await worker
      .post("/auditoria", {
        ator: `${s.nome} (painel)`,
        acao: "numero.pareamento",
        alvo: `numero:${instanceId}`,
      })
      .catch(() => {});
    return { url: r.url, erro: null };
  } catch (e) {
    return { url: null, erro: (e as Error).message };
  }
}
