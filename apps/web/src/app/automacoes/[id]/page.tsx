import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { productPlaceholder } from "@achadinhos/creative";
import { CreativePreview } from "@/components/creative-preview";
import { ProductThumb } from "@/components/product-thumb";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IconSend } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable } from "@/components/ui/table";
import { estimatePostsPerDay } from "@/lib/estimate";
import { formatBRL, formatDateTime } from "@/lib/format";
import { account, discountOf, isEmptyPreview, offerById, offers, sends } from "@/lib/mock";
import { container, viewSession } from "@/server/context";
import { DeleteAutomationButton } from "@/components/delete-automation-button";

export const metadata: Metadata = { title: "Automação" };

export default async function AutomacaoDetalhe({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ vazio?: string }>;
}) {
  const { id } = await params;
  const c = await container();
  const session = await viewSession(c, isEmptyPreview(await searchParams));
  const a = session ? await c.automations.get(session.accountId, id) : null;
  if (!a) notFound();
  const groupList = await c.connections.listGroups(a.accountId);
  const groupById = (gid: string) => groupList.find((g) => g.id === gid);
  const DAY = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
  const f = a.filters as { category?: string; priceMax?: number; minDiscount?: number; minCommission?: number; minRating?: number };

  const est = estimatePostsPerDay({ groups: a.groupIds.length, windowStart: a.windowStart, windowEnd: a.windowEnd, frequencyMin: a.frequencyMin, dailyCap: account.dailyCapPerChannel });
  const history = sends.filter((s) => s.automationId === a.id); // envios reais entram no T8-07
  const sample = offers[0]!;

  return (
    <>
      <p className="mb-2 text-sm">
        <Link href="/automacoes" className="font-medium text-ink-2 underline-offset-2 hover:underline">← Automações</Link>
      </p>
      <PageHeader
        title={a.name}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusBadge status={a.status} />
            <span>
              {a.windowStart}–{a.windowEnd} · a cada {a.frequencyMin} min · ~{est.capped} posts/dia
            </span>
          </span>
        }
        actions={
          <>
            <Button variant="secondary" href={`/automacoes/${a.id}/editar`}>Editar</Button>
            <DeleteAutomationButton id={a.id} />
          </>
        }
      />

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="grid gap-6">
          <Card title="Regras">
            <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
              <Row label="Categoria" value={f.category || "Todas"} />
              <Row label="Preço máximo" value={f.priceMax ? formatBRL(f.priceMax) : "Sem limite"} />
              <Row label="Desconto mínimo" value={`${f.minDiscount ?? 0}%`} />
              <Row label="Comissão mínima" value={`${f.minCommission ?? 0}%`} />
              <Row label="Avaliação mínima" value={String(f.minRating ?? 0).replace(".", ",")} />
              <Row label="Dias" value={a.days.map((d) => DAY[d]).join(", ")} />
              <Row label="Cabeçalho" value={a.header || "—"} />
              <Row label="Rodapé" value={a.footer || "—"} />
              <div className="sm:col-span-2">
                <dt className="text-sm text-ink-2">Grupos</dt>
                <dd className="mt-1.5 flex flex-wrap gap-2">
                  {a.groupIds.map((gid) => (
                    <Badge key={gid} tone={groupById(gid)?.active ? "brand" : "neutral"}>{groupById(gid)?.name ?? "Grupo removido"}</Badge>
                  ))}
                </dd>
              </div>
            </dl>
          </Card>

          <Card title="Envios desta automação" flush>
            {history.length === 0 ? (
              <div className="px-5 pb-5">
                <EmptyState icon={<IconSend />} title="Ainda sem envios" action={<Button variant="secondary">Mandar agora</Button>}>
                  Assim que a automação rodar dentro da janela, cada post aparece aqui com status e motivo.
                </EmptyState>
              </div>
            ) : (
              <DataTable
                caption="Envios da automação"
                rows={history}
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
                          <ProductThumb offer={o} size={36} />
                          <span className="line-clamp-2 min-w-0">{o.title}</span>
                        </span>
                      );
                    },
                  },
                  { key: "group", header: "Grupo", cell: (s) => s.groupId },
                  { key: "when", header: "Horário", cell: (s) => formatDateTime(s.sentAt ?? s.scheduledFor) },
                  { key: "status", header: "Status", cell: (s) => <StatusBadge status={s.status} /> },
                ]}
              />
            )}
          </Card>
        </div>

        <Card title="Prévia do criativo" description="1080×1080 gerado no servidor com a oferta mais recente.">
          <CreativePreview
            title={sample.title}
            imageUrl={productPlaceholder(sample.hue, sample.label)}
            priceCurrent={sample.price}
            priceOld={sample.oldPrice}
            discountPct={discountOf(sample)}
            affiliateHandle={account.handle}
          />
        </Card>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-sm text-ink-2">{label}</dt>
      <dd className="mt-0.5 text-[0.9375rem] font-semibold text-ink">{value}</dd>
    </div>
  );
}
