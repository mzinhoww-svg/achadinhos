import { createHash } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { permitir } from "@/lib/limite";
import { ErroWorker, worker } from "@/lib/worker";

export const dynamic = "force-dynamic";

/**
 * Link curto das ofertas (T5.2): registra o clique (hash do IP com sal, user agent, oferta, grupo e horário)
 * e redireciona (302) para o link de afiliado. O IP nunca é guardado.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await ctx.params;
  if (!/^[A-Za-z0-9]{4,16}$/.test(codigo)) return new NextResponse("Link não encontrado.", { status: 404 });
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null;
  const sal = env("AUTH_SECRET") ?? "achadinhos";
  const ipHash = ip ? createHash("sha256").update(`${sal}:${ip}`).digest("hex").slice(0, 32) : null;
  if (!permitir(ipHash ?? "sem-ip")) {
    return new NextResponse("Muitos acessos seguidos. Tente de novo em um minuto.", {
      status: 429,
      headers: { "retry-after": "60" },
    });
  }
  try {
    const { destino } = await worker.clique(codigo, ipHash, req.headers.get("user-agent"));
    if (!/^https:\/\//.test(destino)) return new NextResponse("Link inválido.", { status: 404 });
    return NextResponse.redirect(destino, {
      status: 302,
      headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" },
    });
  } catch (e) {
    const status = e instanceof ErroWorker && e.status === 404 ? 404 : 503;
    return new NextResponse(status === 404 ? "Link não encontrado." : "Tente de novo em instantes.", {
      status,
    });
  }
}
