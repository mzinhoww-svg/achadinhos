import Link from "next/link";
import { Cabecalho } from "@/components/cabecalho";
import { Kpi } from "@/components/kpi";
import { StatusDot } from "@/components/status-dot";
import { Card } from "@/components/ui/card";
import { brl, hora, type NumeroGateway, type Resumo, usd } from "@/lib/tipos";
import { worker } from "@/lib/worker";
import { CartaoStatus } from "./pausa";

export const dynamic = "force-dynamic";

const TEXTO_ALERTA: Record<string, (d: Record<string, unknown>) => string> = {
  alerta: (d) => String(d.texto ?? ""),
  "sistema.pausado": (d) => `Pausado: ${String(d.motivo ?? "")}`,
  numero_banido: (d) => `Número ${String(d.numero ?? "")} caiu: ${String(d.motivo ?? "")}`,
  "numero.failover": (d) => `Troca de número: ${String(d.de ?? "?")} → ${String(d.para ?? "?")}`,
  "disparo.cancelado": (d) => `Envio cancelado: ${String(d.motivo ?? "")}`,
  "marketplace.erro": (d) => `Shopee: ${String(d.codigo ?? "")} (${String(d.alvo ?? d.metodo ?? "")})`,
};

export default async function VisaoGeral() {
  const [pausa, resumo, numeros] = await Promise.all([
    worker.pausa().catch(() => ({ pausado: false, motivo: null, por: null, em: null })),
    worker.get<Resumo>("/painel/resumo").catch(() => null),
    worker.get<{ numeros: NumeroGateway[] }>("/numeros").catch(() => null),
  ]);
  const proxima = resumo?.proxima
    ? `próxima oferta ${hora(resumo.proxima.em)} em ${resumo.proxima.grupo}`
    : null;
  const pctLlm = resumo
    ? Math.min(100, Math.round((resumo.llm.dia / Math.max(resumo.llm.tetoDiario, 0.01)) * 100))
    : 0;
  return (
    <div className="flex flex-col gap-5">
      <Cabecalho titulo="Visão geral" descricao="O dia da operação, de relance." />
      <CartaoStatus pausa={pausa} proxima={proxima} />

      {!resumo ? (
        <Card className="p-5 text-sm text-muted-foreground">
          O worker não respondeu. Veja se a app worker está no ar na Vertra.
        </Card>
      ) : (
        <>
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">Ofertas de hoje</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Kpi rotulo="Enviadas" valor={resumo.ofertas.enviadas} />
              <Kpi rotulo="Agendadas" valor={resumo.ofertas.agendadas} />
              <Kpi rotulo="Reprovadas na checagem" valor={resumo.ofertas.reprovadas} />
              <Kpi rotulo="Avaliadas" valor={resumo.ofertas.avaliadas} />
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">Cliques e conversões</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Kpi rotulo="Cliques" valor={resumo.cliques.hoje} anterior={resumo.cliques.ontem} />
              <Kpi rotulo="Conversões" valor={resumo.conversoes.hoje} anterior={resumo.conversoes.ontem} />
              <Kpi
                rotulo="Comissão estimada"
                valor={resumo.comissao.hoje}
                anterior={resumo.comissao.ontem}
                formato={(v) => brl(v)}
              />
            </div>
          </section>

          <section className="grid gap-3 sm:grid-cols-2">
            <Card className="flex flex-col gap-3 p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium">Saúde dos números</h2>
                <Link href="/chips" className="text-xs text-primary hover:underline">
                  ver chips
                </Link>
              </div>
              {!numeros ? (
                <p className="text-sm text-muted-foreground">wa-gateway sem resposta (ou não configurado).</p>
              ) : numeros.numeros.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum chip pareado ainda.</p>
              ) : (
                <ul className="flex flex-col gap-2 text-sm">
                  {numeros.numeros.map((n) => (
                    <li key={n.instanceId} className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2">
                        <StatusDot
                          tipo={
                            n.conexao === "open"
                              ? "ok"
                              : n.papel === "banido" || n.papel === "bloqueado"
                                ? "erro"
                                : "aviso"
                          }
                        />
                        {n.instanceId}
                      </span>
                      <span className="text-muted-foreground">
                        {n.papel} ·{" "}
                        {n.conexao === "open" ? "conectado" : n.aguardandoQr ? "aguardando QR" : n.conexao}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card className="flex flex-col gap-3 p-5">
              <h2 className="text-sm font-medium">Gasto com IA</h2>
              <p className="text-2xl font-semibold tabular-nums">
                {usd(resumo.llm.dia)}{" "}
                <span className="text-sm font-normal text-muted-foreground">
                  de {usd(resumo.llm.tetoDiario)} hoje
                </span>
              </p>
              <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                <div className="h-full bg-primary" style={{ width: `${pctLlm}%` }} />
              </div>
              <p className="text-xs text-muted-foreground">
                No mês: {usd(resumo.llm.mes)} de {usd(resumo.llm.tetoMensal)}. Acima do teto, a copy usa o
                texto padrão.
              </p>
            </Card>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">Alertas recentes</h2>
            <Card className="divide-y">
              {resumo.alertas.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">Nada de anormal nas últimas 24 horas.</p>
              ) : (
                resumo.alertas.map((a) => (
                  <div key={a.id} className="flex items-start justify-between gap-3 p-4 text-sm">
                    <span>{(TEXTO_ALERTA[a.tipo] ?? ((d) => JSON.stringify(d)))(a.dados)}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{hora(a.criadoEm)}</span>
                  </div>
                ))
              )}
            </Card>
          </section>
        </>
      )}
    </div>
  );
}
