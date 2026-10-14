import type { Metadata } from "next";
import Link from "next/link";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IconBolt, IconPlus } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable } from "@/components/ui/table";
import { estimatePostsPerDay } from "@/lib/estimate";
import { account, automations, isEmptyPreview } from "@/lib/mock";

export const metadata: Metadata = { title: "Automações" };

export default async function AutomacoesPage({ searchParams }: { searchParams: Promise<{ vazio?: string }> }) {
  const empty = isEmptyPreview(await searchParams);
  const list = empty ? [] : automations;
  const atLimit = list.length >= account.maxAutomations;

  return (
    <>
      <PageHeader
        title="Automações"
        description="Cada automação escolhe ofertas por filtro e posta nos grupos dentro da janela definida."
        actions={
          <Button href="/automacoes/nova" disabled={atLimit} icon={<IconPlus width={18} height={18} />}>
            Nova automação
          </Button>
        }
      />
      {list.length === 0 ? (
        <EmptyState
          icon={<IconBolt />}
          title="Você ainda não tem automações"
          action={<Button href="/automacoes/nova" icon={<IconPlus width={18} height={18} />}>Criar a primeira</Button>}
        >
          Uma automação define quais ofertas buscar, em que horários postar e para quais grupos. Você pode ter até {account.maxAutomations}.
        </EmptyState>
      ) : (
        <Card
          flush
          title="Suas automações"
          action={<Badge tone={atLimit ? "warn" : "neutral"}>{list.length} de {account.maxAutomations}</Badge>}
        >
          <DataTable
            caption="Automações"
            rows={list}
            rowKey={(a) => a.id}
            columns={[
              {
                key: "name",
                header: "Nome",
                mobile: "title",
                cell: (a) => (
                  <Link href={`/automacoes/${a.id}`} className="font-semibold text-brand-700 underline-offset-2 hover:underline">
                    {a.name}
                  </Link>
                ),
              },
              { key: "status", header: "Status", cell: (a) => <StatusBadge status={a.status} /> },
              { key: "groups", header: "Grupos", align: "right", cell: (a) => a.groupIds.length },
              { key: "window", header: "Janela", cell: (a) => `${a.windowStart}–${a.windowEnd}` },
              { key: "freq", header: "Frequência", cell: (a) => `a cada ${a.frequencyMin} min` },
              {
                key: "est",
                header: "Posts/dia",
                align: "right",
                cell: (a) =>
                  estimatePostsPerDay({ groups: a.groupIds.length, windowStart: a.windowStart, windowEnd: a.windowEnd, frequencyMin: a.frequencyMin }).capped,
              },
            ]}
          />
        </Card>
      )}
    </>
  );
}
