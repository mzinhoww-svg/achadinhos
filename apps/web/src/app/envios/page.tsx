import type { Metadata } from "next";
import Link from "next/link";
import { EnviosLive } from "@/components/envios-live";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/form";
import { IconSend } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { cx } from "@/lib/cx";
import { isEmptyPreview } from "@/lib/mock";
import { getConnections } from "@/server/connections";
import { container, viewSession } from "@/server/context";
import { getEnvios, type StatusFilter } from "@/server/envios";

export const metadata: Metadata = { title: "Envios" };

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "Todos" },
  { key: "queued", label: "Na fila" },
  { key: "sent", label: "Enviados" },
  { key: "failed", label: "Falhas" },
  { key: "skipped", label: "Ignorados" },
];

type SP = { vazio?: string; status?: string; grupo?: string };

export default async function EnviosPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const c = await container();
  const session = await viewSession(c, isEmptyPreview(sp));
  const header = (
    <PageHeader
      title="Envios"
      description="Hoje e os últimos 30 dias. Falhas não são reenviadas sozinhas; use “Mandar agora” para tentar de novo."
      actions={<Button href="/mandar-agora" icon={<IconSend width={18} height={18} />}>Mandar agora</Button>}
    />
  );
  if (!session) {
    return (
      <>
        {header}
        <EmptyState icon={<IconSend />} title="Sessão necessária">Entre na sua conta para ver os envios.</EmptyState>
      </>
    );
  }

  const view = await getEnvios({ sends: c.sends }, session, { status: sp.status, groupId: sp.grupo });
  const { telegram } = await getConnections({ repo: c.connections, vault: c.vault, telegram: c.telegram }, session);
  const groups = telegram?.groups ?? [];
  const empty = isEmptyPreview(sp);
  const qs = (status: StatusFilter, grupo: string | null) => {
    const p = new URLSearchParams();
    if (status !== "all") p.set("status", status);
    if (grupo) p.set("grupo", grupo);
    if (empty) p.set("vazio", "1");
    const s = p.toString();
    return s ? `?${s}` : "";
  };

  return (
    <>
      {header}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <nav aria-label="Filtrar por status" className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <Link
              key={f.key}
              href={`/envios${qs(f.key, view.filter.groupId)}`}
              aria-current={view.filter.status === f.key ? "page" : undefined}
              className={cx(
                "inline-flex h-10 items-center rounded-control border px-3.5 text-sm font-semibold transition-colors duration-150",
                view.filter.status === f.key ? "border-brand-600 bg-brand-50 text-brand-700" : "border-line-strong text-ink-2 hover:border-ink-3 hover:bg-sunken",
              )}
            >
              {f.label}
            </Link>
          ))}
        </nav>
        {groups.length > 0 && (
          <form action="/envios" method="get" className="flex items-center gap-2" aria-label="Filtrar por grupo">
            {view.filter.status !== "all" && <input type="hidden" name="status" value={view.filter.status} />}
            {empty && <input type="hidden" name="vazio" value="1" />}
            <label htmlFor="grupo" className="sr-only">Grupo</label>
            <Select id="grupo" name="grupo" defaultValue={view.filter.groupId ?? ""} className="h-10 min-w-40">
              <option value="">Todos os grupos</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </Select>
            <Button type="submit" variant="secondary" size="sm">Filtrar</Button>
          </form>
        )}
      </div>

      <EnviosLive initial={view} accountId={session.accountId} empty={empty} />
    </>
  );
}
