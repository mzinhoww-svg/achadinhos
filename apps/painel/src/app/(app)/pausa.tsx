"use client";

import { useState } from "react";
import { Confirmar } from "@/components/confirmar";
import { StatusDot } from "@/components/status-dot";
import { Card } from "@/components/ui/card";

/**
 * Cartão de status com PAUSAR / RETOMAR, num só estado. Na demonstração só troca na tela;
 * o real chama /pausa no worker.
 */
export function CartaoStatus({
  pausada: inicial,
  desde,
  proxima,
}: {
  pausada: boolean;
  desde: string;
  proxima: string;
}) {
  const [pausada, setPausada] = useState(inicial);
  return (
    <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3" aria-live="polite">
        <StatusDot tipo={pausada ? "aviso" : "ok"} className="size-3" />
        <div>
          <p className="font-semibold">{pausada ? "Operação pausada" : "Operação rodando"}</p>
          <p className="text-sm text-muted-foreground">
            {pausada ? "Nenhuma oferta sai até você retomar." : `desde ${desde} · ${proxima}`}
          </p>
        </div>
      </div>
      {pausada ? (
        <Confirmar
          grande
          rotulo="RETOMAR"
          titulo="Retomar a operação?"
          texto="Os agentes voltam a buscar, checar e enviar ofertas nos próximos horários."
          confirmar="Retomar"
          aoConfirmar={() => setPausada(false)}
        />
      ) : (
        <Confirmar
          grande
          rotulo="PAUSAR"
          titulo="Pausar toda a operação?"
          texto="Nenhuma oferta sai até você retomar. Os envios agendados ficam parados."
          confirmar="Pausar agora"
          aoConfirmar={() => setPausada(true)}
        />
      )}
    </Card>
  );
}
