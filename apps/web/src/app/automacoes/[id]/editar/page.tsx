import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AutomationForm } from "@/components/automation-form";
import { PageHeader } from "@/components/ui/page-header";
import { account, isEmptyPreview } from "@/lib/mock";
import { container, viewSession } from "@/server/context";

export const metadata: Metadata = { title: "Editar automação" };

export default async function EditarAutomacao({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ vazio?: string }> }) {
  const { id } = await params;
  const c = await container();
  const session = await viewSession(c, isEmptyPreview(await searchParams));
  const a = session ? await c.automations.get(session.accountId, id) : null;
  if (!session || !a) notFound();
  const groups = (await c.connections.listGroups(session.accountId)).filter((g) => g.active || a.groupIds.includes(g.id));
  const f = a.filters as Record<string, unknown>;
  const s = (v: unknown) => (v === undefined || v === null ? "" : String(v));
  return (
    <>
      <PageHeader title="Editar automação" description={a.name} />
      <AutomationForm
        groups={groups.map((g) => ({ id: g.id, name: g.name }))}
        automationsUsed={(await c.automations.list(session.accountId)).length}
        maxAutomations={account.maxAutomations}
        dailyCap={account.dailyCapPerChannel}
        initial={{
          id: a.id,
          name: a.name,
          days: a.days,
          windowStart: a.windowStart,
          windowEnd: a.windowEnd,
          frequencyMin: a.frequencyMin,
          groupIds: a.groupIds,
          header: a.header ?? "",
          footer: a.footer ?? "",
          category: s(f.category),
          maxPrice: s(f.priceMax),
          minDiscount: s(f.minDiscount),
          minCommission: s(f.minCommission),
          minRating: s(f.minRating),
          minSales: s(f.minSales),
        }}
      />
    </>
  );
}
