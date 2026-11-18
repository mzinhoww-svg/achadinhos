import { sessaoAtual } from "@/lib/auth";
import { configWorker } from "@/lib/worker";

export const dynamic = "force-dynamic";

/**
 * Repassa o fluxo SSE do worker (/eventos/stream) para o navegador. O SERVICE_TOKEN fica no servidor;
 * o navegador só precisa da sessão do admin.
 */
export async function GET(req: Request) {
  if (!(await sessaoAtual())) return new Response("não autorizado", { status: 401 });
  let cfg: ReturnType<typeof configWorker>;
  try {
    cfg = configWorker();
  } catch (e) {
    return new Response(e instanceof Error ? e.message : "worker não configurado", { status: 500 });
  }
  const desde = new URL(req.url).searchParams.get("desde");
  const alvo = `${cfg.url}/eventos/stream${desde && /^\d+$/.test(desde) ? `?desde=${desde}` : ""}`;
  const res = await fetch(alvo, {
    headers: { "x-service-token": cfg.token, accept: "text/event-stream" },
    signal: req.signal,
    cache: "no-store",
  }).catch(() => null);
  if (!res?.ok || !res.body) return new Response("o worker não abriu o fluxo de eventos", { status: 502 });
  return new Response(res.body, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
