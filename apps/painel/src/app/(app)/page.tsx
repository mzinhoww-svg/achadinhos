import Link from "next/link";
import { Cabecalho } from "@/components/cabecalho";
import { FaixaDemo } from "@/components/faixa-demo";
import { Kpi } from "@/components/kpi";
import { StatusDot } from "@/components/status-dot";
import { Card } from "@/components/ui/card";
import { ALERTAS, brl, HOJE, usd } from "@/lib/demo";
import { worker } from "@/lib/worker";
import { CartaoStatus } from "./pausa";

export default async function VisaoGeral() {
  const pausa = await worker.pausa().catch(() => ({ pausado: false, motivo: null, por: null, em: null }));
  const pctLlm = Math.round((HOJE.llm.hojeUsd / HOJE.llm.tetoUsd) * 100);
  return (
    <div className="flex flex-col gap-5">
      <Cabecalho titulo="Visão geral" descricao="O dia da operação, de relance." />
      <CartaoStatus pausa={pausa} proxima={null} />
      <FaixaDemo motivo="Os números abaixo ainda são de demonstração; entram com dados reais no Prompt 6." />

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Ofertas de hoje</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Kpi rotulo="Enviadas" valor={HOJE.enviadas} />
          <Kpi rotulo="Reprovadas na checagem" valor={HOJE.reprovadas} />
          <Kpi rotulo="Avaliadas" valor={HOJE.avaliadas} />
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Cliques e conversões</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Kpi rotulo="Cliques" valor={HOJE.cliques.hoje} anterior={HOJE.cliques.ontem} />
          <Kpi rotulo="Conversões" valor={HOJE.conversoes.hoje} anterior={HOJE.conversoes.ontem} />
          <Kpi rotulo="Comissão" valor={HOJE.comissao.hoje} anterior={HOJE.comissao.ontem} formato={brl} />
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <Card className="flex flex-col gap-3 p-4">
          <h2 className="text-sm font-medium">Alertas</h2>
          <ul className="flex flex-col gap-2">
            {ALERTAS.map((a) => (
              <li key={a.texto}>
                <Link href={a.href} className="flex items-start gap-2 rounded-md p-2 text-sm hover:bg-accent">
                  <StatusDot tipo={a.nivel === "aviso" ? "aviso" : "neutro"} className="mt-1.5" />
                  {a.texto}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="flex flex-col gap-3 p-4">
          <h2 className="text-sm font-medium">Gasto de LLM hoje</h2>
          <p className="text-2xl font-semibold tabular-nums">
            {usd(HOJE.llm.hojeUsd)}{" "}
            <span className="text-sm font-normal text-muted-foreground">de {usd(HOJE.llm.tetoUsd)}</span>
          </p>
          <div
            className="h-2 overflow-hidden rounded-full bg-muted"
            role="img"
            aria-label={`${pctLlm}% do teto diário`}
          >
            <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(pctLlm, 100)}%` }} />
          </div>
          <p className="text-xs text-muted-foreground">A operação pausa sozinha ao atingir o teto diário.</p>
        </Card>
      </section>
    </div>
  );
}
