"use server";

import { exigirSessao } from "@/lib/auth";
import { ErroWorker, worker } from "@/lib/worker";

export interface EstadoSenha {
  erro: string | null;
  ok: boolean;
}

export async function trocarSenha(_anterior: EstadoSenha, form: FormData): Promise<EstadoSenha> {
  const sessao = await exigirSessao();
  const atual = String(form.get("atual") ?? "");
  const nova = String(form.get("nova") ?? "");
  const confirma = String(form.get("confirma") ?? "");
  if (nova.length < 12) return { erro: "A senha nova precisa de pelo menos 12 caracteres.", ok: false };
  if (nova !== confirma) return { erro: "A confirmação não confere com a senha nova.", ok: false };
  try {
    await worker.trocarSenha(sessao.email, atual, nova);
    return { erro: null, ok: true };
  } catch (e) {
    return { erro: e instanceof ErroWorker ? e.message : "Não foi possível trocar a senha.", ok: false };
  }
}
