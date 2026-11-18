"use client";

import { useTransition } from "react";
import { alternarPausa } from "@/app/(app)/acoes-pausa";
import { Confirmar } from "@/components/confirmar";

/** Botão "Pausar tudo", fixo no topo de todas as telas (T6.3). */
export function BotaoPausa({ pausado, grande = false }: { pausado: boolean; grande?: boolean }) {
  const [pendente, iniciar] = useTransition();
  const rodar = (pausar: boolean) => iniciar(() => alternarPausa(pausar));
  if (pendente) return <span className="text-sm text-muted-foreground">Aplicando…</span>;
  return pausado ? (
    <Confirmar
      grande={grande}
      rotulo="RETOMAR"
      titulo="Retomar a operação?"
      texto="Os agentes voltam a buscar, checar e enviar ofertas nos próximos horários."
      confirmar="Retomar"
      aoConfirmar={() => rodar(false)}
    />
  ) : (
    <Confirmar
      grande={grande}
      rotulo={grande ? "PAUSAR" : "Pausar tudo"}
      titulo="Pausar toda a operação?"
      texto="Nenhuma oferta sai até você retomar. Os envios agendados ficam parados."
      confirmar="Pausar agora"
      aoConfirmar={() => rodar(true)}
    />
  );
}
