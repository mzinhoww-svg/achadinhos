import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";

/**
 * Sessão do admin num cookie assinado (HMAC-SHA256 com AUTH_SECRET). O painel não guarda estado:
 * o worker confere a senha, e o painel só assina quem entrou e até quando.
 */
export interface Sessao {
  id: number;
  email: string;
  nome: string;
  /** Expira em (ms desde 1970). */
  exp: number;
}

export const COOKIE_SESSAO = "achadinhos_sessao";
export const DURACAO_SESSAO_MS = 12 * 60 * 60 * 1000;

function segredo(s?: string): string {
  const v = s ?? env("AUTH_SECRET");
  if (!v || v.length < 32) throw new Error("AUTH_SECRET ausente ou curto (mínimo 32 caracteres).");
  return v;
}

const assinar = (dados: string, s: string) => createHmac("sha256", s).update(dados).digest("base64url");

export function criarToken(sessao: Omit<Sessao, "exp">, agora = Date.now(), s?: string): string {
  const dados = Buffer.from(JSON.stringify({ ...sessao, exp: agora + DURACAO_SESSAO_MS })).toString(
    "base64url",
  );
  return `${dados}.${assinar(dados, segredo(s))}`;
}

export function lerToken(token: string | undefined, agora = Date.now(), s?: string): Sessao | null {
  if (!token) return null;
  const [dados, assinatura] = token.split(".");
  if (!dados || !assinatura) return null;
  const esperado = Buffer.from(assinar(dados, segredo(s)));
  const recebido = Buffer.from(assinatura);
  if (esperado.length !== recebido.length || !timingSafeEqual(esperado, recebido)) return null;
  try {
    const v = JSON.parse(Buffer.from(dados, "base64url").toString("utf8")) as Sessao;
    if (typeof v.exp !== "number" || v.exp < agora || typeof v.email !== "string") return null;
    return v;
  } catch {
    return null;
  }
}
