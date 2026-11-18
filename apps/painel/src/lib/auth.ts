import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_SESSAO, lerToken, type Sessao } from "./sessao";

export async function sessaoAtual(): Promise<Sessao | null> {
  const c = await cookies();
  return lerToken(c.get(COOKIE_SESSAO)?.value);
}

export async function exigirSessao(): Promise<Sessao> {
  const s = await sessaoAtual();
  if (!s) redirect("/login");
  return s;
}
