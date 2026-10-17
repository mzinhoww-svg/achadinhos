"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { refreshEnviosAction } from "@/app/envios/actions";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IconSend } from "@/components/ui/icons";
import { DataTable } from "@/components/ui/table";
import { type PublicSend } from "@/lib/envios-view";
import { formatDateTime } from "@/lib/format";
import type { EnviosView } from "@/server/envios";

const POLL_MS = 8_000;

const CARDS = [
  { key: "sent", label: "Enviados hoje", tone: "text-ok" },
  { key: "queued", label: "Na fila agora", tone: "text-info" },
  { key: "failed", label: "Falhas hoje", tone: "text-err" },
  { key: "skipped", label: "Ignorados hoje", tone: "text-ink-2" },
] as const;

/**
 * T8-A: a tela não usa mais o Realtime do Supabase (dormente). Relê periodicamente do container
 * em memória; sem persistência, é o único jeito de refletir mudanças de estado.
 */
export function EnviosLive({ initial, empty }: { initial: EnviosView; empty: boolean }) {
  const [items, setItems] = useState<PublicSend[]>(initial.items);
  const [today, setToday] = useState(initial.today);
  const view = useRef(initial);

  // Nova navegação (outro filtro) entrega outro `initial`: recomeça do que o servidor mandou.
  useEffect(() => {
    view.current = initial;
    setItems(initial.items);
    setToday(initial.today);
  }, [initial]);

  const reload = useCallback(async () => {
    const r = await refreshEnviosAction(view.current.filter.status, view.current.filter.groupId);
    if (!r.ok) return;
    view.current = r.data;
    setItems(r.data.items);
    setToday(r.data.today);
  }, []);

  // Releitura periódica (sem Realtime).
  useEffect(() => {
    if (empty) return;
    const t = setInterval(() => void reload(), POLL_MS);
    return () => clearInterval(t);
  }, [empty, reload]);

  const hasFilter = initial.filter.status !== "all" || initial.filter.groupId !== null;

  return (
    <>
      <section aria-label="Resumo do dia" className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {CARDS.map((c) => (
          <div key={c.key} className="rounded-panel border border-line bg-bg p-4">
            <p className="text-sm font-semibold text-ink-2">{c.label}</p>
            <p className={`mt-1 font-display text-3xl font-extrabold leading-none ${c.tone}`} aria-live="polite">
              {today[c.key]}
            </p>
          </div>
        ))}
      </section>

      <p className="mb-3 flex items-center gap-2 text-sm text-ink-2" role="status">
        <span aria-hidden className="size-2 rounded-full bg-ok" />
        Atualiza sozinho a cada poucos segundos
      </p>

      {items.length === 0 ? (
        <EmptyState
          icon={<IconSend />}
          title={hasFilter ? "Nenhum envio com esse filtro" : "Nenhum envio ainda"}
          action={
            hasFilter ? (
              <Button href={empty ? "/envios?vazio=1" : "/envios"} variant="secondary">Limpar filtros</Button>
            ) : (
              <>
                <Button href="/mandar-agora">Mandar agora</Button>
                <Button href="/automacoes/nova" variant="secondary">Criar automação</Button>
              </>
            )
          }
        >
          {hasFilter
            ? "Troque ou limpe os filtros para ver o restante dos últimos 30 dias."
            : "Cada post enviado, na fila, ignorado ou com falha fica registrado aqui por 30 dias. Crie uma automação ou mande uma oferta agora."}
        </EmptyState>
      ) : (
        <Card flush>
          <DataTable
            caption="Envios dos últimos 30 dias"
            rows={items}
            rowKey={(s) => s.id}
            columns={[
              {
                key: "offer",
                header: "Oferta",
                mobile: "title",
                cell: (s) => <span className="line-clamp-2 min-w-0">{s.offerTitle ?? "Oferta removida"}</span>,
              },
              { key: "group", header: "Grupo", cell: (s) => s.groupName ?? "Grupo removido" },
              { key: "origin", header: "Origem", cell: (s) => s.origin },
              { key: "when", header: "Horário", cell: (s) => formatDateTime(s.at) },
              {
                key: "status",
                header: "Status",
                cell: (s) => (
                  <span className="flex flex-col items-start gap-1">
                    <StatusBadge status={s.status} />
                    {s.reason && <span className="text-xs text-ink-2">{s.reason}</span>}
                  </span>
                ),
              },
              {
                key: "action",
                header: "Ação",
                align: "right",
                cell: (s) =>
                  s.status === "failed" || s.status === "skipped" ? (
                    <Link href="/mandar-agora" className="text-sm font-semibold text-brand-700 underline">Reenviar</Link>
                  ) : null,
              },
            ]}
          />
        </Card>
      )}
      {initial.truncated && (
        <p className="mt-3 text-sm text-ink-2">Mostrando os 200 mais recentes. Use os filtros para ver os demais.</p>
      )}
    </>
  );
}
