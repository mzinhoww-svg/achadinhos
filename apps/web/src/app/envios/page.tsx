import type { Metadata } from "next";
import Link from "next/link";
import { ProductThumb } from "@/components/product-thumb";
import { StatusBadge, type StatusKey } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IconSend } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable } from "@/components/ui/table";
import { cx } from "@/lib/cx";
import { formatDateTime } from "@/lib/format";
import { groupById, isEmptyPreview, offerById, sends } from "@/lib/mock";

export const metadata: Metadata = { title: "Envios" };

const FILTERS: { key: "all" | StatusKey; label: string }[] = [
  { key: "all", label: "Todos" },
  { key: "queued", label: "Na fila" },
  { key: "sent", label: "Enviados" },
  { key: "failed", label: "Falhas" },
  { key: "skipped", label: "Ignorados" },
];

export default async function EnviosPage({ searchParams }: { searchParams: Promise<{ vazio?: string; status?: string }> }) {
  const sp = await searchParams;
  const empty = isEmptyPreview(sp);
  const active = FILTERS.find((f) => f.key === sp.status)?.key ?? "all";
  const base = empty ? [] : sends;
  const list = base.filter((s) => active === "all" || s.status === active || (active === "queued" && s.status === "sending"));
  const qs = (status: string) => {
    const p = new URLSearchParams();
    if (status !== "all") p.set("status", status);
    if (empty) p.set("vazio", "1");
    const s = p.toString();
    return s ? `?${s}` : "";
  };

  return (
    <>
      <PageHeader
        title="Envios"
        description="Histórico e fila. Falhas não são reenviadas sozinhas; use “Mandar agora” para tentar de novo."
        actions={<Button href="/mandar-agora" icon={<IconSend width={18} height={18} />}>Mandar agora</Button>}
      />

      <nav aria-label="Filtrar por status" className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={`/envios${qs(f.key)}`}
            aria-current={active === f.key ? "page" : undefined}
            className={cx(
              "inline-flex h-10 items-center rounded-control border px-3.5 text-sm font-semibold transition-colors duration-150",
              active === f.key ? "border-brand-600 bg-brand-50 text-brand-700" : "border-line-strong text-ink-2 hover:border-ink-3 hover:bg-sunken",
            )}
          >
            {f.label}
          </Link>
        ))}
      </nav>

      {list.length === 0 ? (
        <EmptyState
          icon={<IconSend />}
          title={empty || active === "all" ? "Nenhum envio ainda" : "Nenhum envio com esse status"}
          action={
            active !== "all" && !empty ? (
              <Button href="/envios" variant="secondary">Ver todos</Button>
            ) : (
              <Button href="/automacoes/nova" variant="secondary">Criar automação</Button>
            )
          }
        >
          {empty || active === "all"
            ? "Cada post enviado, na fila, ignorado ou com falha fica registrado aqui. O histórico é só de inserção."
            : "Troque o filtro para ver o restante do histórico."}
        </EmptyState>
      ) : (
        <Card flush>
          <DataTable
            caption="Envios"
            rows={list}
            rowKey={(s) => s.id}
            columns={[
              {
                key: "offer",
                header: "Oferta",
                mobile: "title",
                cell: (s) => {
                  const o = offerById(s.offerId);
                  return (
                    <span className="flex items-center gap-3">
                      <ProductThumb offer={o} size={40} />
                      <span className="line-clamp-2 min-w-0">{o.title}</span>
                    </span>
                  );
                },
              },
              { key: "group", header: "Grupo", cell: (s) => groupById(s.groupId)?.name },
              { key: "when", header: "Horário", cell: (s) => formatDateTime(s.sentAt ?? s.scheduledFor) },
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
                    <Button size="sm" variant="secondary">Mandar agora</Button>
                  ) : s.status === "queued" ? (
                    <Button size="sm" variant="ghost">Priorizar</Button>
                  ) : null,
              },
            ]}
          />
        </Card>
      )}
    </>
  );
}
