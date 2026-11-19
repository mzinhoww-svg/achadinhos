"use client";

import type { Evento } from "@achadinhos/shared";
import { useEffect, useMemo, useState } from "react";
import { StatusDot } from "@/components/status-dot";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { dataHora } from "@/lib/utils";

const LIMITE = 500;

export function LogAoVivo({ iniciais }: { iniciais: Evento[] }) {
  const [eventos, setEventos] = useState<Evento[]>(iniciais);
  const [conectado, setConectado] = useState(false);
  const [agente, setAgente] = useState("");
  const [tipo, setTipo] = useState("");

  useEffect(() => {
    const desde = iniciais.reduce((m, e) => Math.max(m, e.id), 0);
    const fonte = new EventSource(`/api/eventos/stream?desde=${desde}`);
    fonte.onopen = () => setConectado(true);
    fonte.onerror = () => setConectado(false); // o EventSource reconecta sozinho
    fonte.addEventListener("evento", (m) => {
      const e = JSON.parse((m as MessageEvent<string>).data) as Evento;
      setEventos((atual) => (atual.some((x) => x.id === e.id) ? atual : [e, ...atual].slice(0, LIMITE)));
    });
    return () => fonte.close();
  }, [iniciais]);

  const agentes = useMemo(() => [...new Set(eventos.map((e) => e.agente))].sort(), [eventos]);
  const tipos = useMemo(() => [...new Set(eventos.map((e) => e.tipo))].sort(), [eventos]);
  const visiveis = eventos.filter((e) => (!agente || e.agente === agente) && (!tipo || e.tipo === tipo));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <label htmlFor="log-agente" className="flex flex-col gap-1 text-xs text-muted-foreground">
          Agente
          <Select id="log-agente" value={agente} onChange={(e) => setAgente(e.target.value)}>
            <option value="">Todos</option>
            {agentes.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </Select>
        </label>
        <label htmlFor="log-tipo" className="flex flex-col gap-1 text-xs text-muted-foreground">
          Tipo
          <Select id="log-tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="">Todos</option>
            {tipos.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
        </label>
        <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          <StatusDot tipo={conectado ? "ok" : "aviso"} />
          {conectado ? "ao vivo" : "reconectando…"}
        </span>
      </div>
      {visiveis.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">
          Nenhum evento ainda. Eles aparecem aqui assim que os agentes começarem a trabalhar.
        </Card>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {visiveis.map((e) => (
            <li key={e.id}>
              <details className="rounded-lg border bg-card px-3 py-2">
                <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="font-mono text-xs text-muted-foreground">{dataHora(e.criadoEm)}</span>
                  <span className="font-medium">{e.agente}</span>
                  <span className="font-mono text-xs">{e.tipo}</span>
                  {e.ofertaId ? (
                    <span className="text-xs text-muted-foreground">oferta #{e.ofertaId}</span>
                  ) : null}
                </summary>
                <pre className="mt-2 overflow-x-auto text-xs">{JSON.stringify(e.dados, null, 2)}</pre>
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
