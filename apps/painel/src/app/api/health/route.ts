import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Saúde do painel (para a Vertra e para conferir o deploy). Não chama o worker nem expõe segredos. */
export function GET() {
  return Response.json({
    ok: true,
    servico: "achadinhos-painel",
    workerConfigurado: Boolean(env("WORKER_URL") && env("SERVICE_TOKEN")),
    authConfigurado: (env("AUTH_SECRET")?.length ?? 0) >= 32,
  });
}
