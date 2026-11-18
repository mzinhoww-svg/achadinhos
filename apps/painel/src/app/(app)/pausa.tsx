import { BotaoPausa } from "@/components/botao-pausa";
import { StatusDot } from "@/components/status-dot";
import { Card } from "@/components/ui/card";
import type { EstadoPausa } from "@/lib/worker";

/** Cartão de status com PAUSAR / RETOMAR, ligado ao /pausa do worker. */
export function CartaoStatus({ pausa, proxima }: { pausa: EstadoPausa; proxima: string | null }) {
  const desde = pausa.em
    ? new Date(pausa.em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
    : null;
  return (
    <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3" aria-live="polite">
        <StatusDot tipo={pausa.pausado ? "aviso" : "ok"} className="size-3" />
        <div>
          <p className="font-semibold">{pausa.pausado ? "Operação pausada" : "Operação rodando"}</p>
          <p className="text-sm text-muted-foreground">
            {pausa.pausado
              ? `${pausa.motivo ?? "Nenhuma oferta sai até você retomar."}${pausa.por ? ` · por ${pausa.por}` : ""}${desde ? ` · ${desde}` : ""}`
              : (proxima ?? "Nenhum envio agendado.")}
          </p>
        </div>
      </div>
      <BotaoPausa pausado={pausa.pausado} grande />
    </Card>
  );
}
