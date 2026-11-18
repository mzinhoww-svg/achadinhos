"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_SESSAO, criarToken, DURACAO_SESSAO_MS } from "@/lib/sessao";
import { ErroWorker, worker } from "@/lib/worker";

export interface EstadoLogin {
  erro: string | null;
  /** Devolvido para o formulário não perder o e-mail (o React limpa o form depois da ação). */
  email: string;
}

export async function entrar(_anterior: EstadoLogin, form: FormData): Promise<EstadoLogin> {
  const email = String(form.get("email") ?? "").trim();
  const senha = String(form.get("senha") ?? "");
  if (!email || !senha) return { erro: "Informe e-mail e senha.", email };
  try {
    const { admin } = await worker.login(email, senha);
    const c = await cookies();
    c.set(COOKIE_SESSAO, criarToken(admin), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: DURACAO_SESSAO_MS / 1000,
    });
  } catch (e) {
    if (e instanceof ErroWorker && (e.status === 401 || e.status === 429)) return { erro: e.message, email };
    return { erro: e instanceof Error ? e.message : "Não foi possível entrar.", email };
  }
  redirect("/biblia");
}

export async function sair() {
  (await cookies()).delete(COOKIE_SESSAO);
  redirect("/login");
}
