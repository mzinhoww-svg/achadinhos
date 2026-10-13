import type { Metadata } from "next";
import { AutomationForm } from "@/components/automation-form";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IconPlug } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { account, automations, groups, isEmptyPreview } from "@/lib/mock";

export const metadata: Metadata = { title: "Nova automação" };

export default async function NovaAutomacaoPage({ searchParams }: { searchParams: Promise<{ vazio?: string }> }) {
  const empty = isEmptyPreview(await searchParams);
  const active = empty ? [] : groups.filter((g) => g.active).map((g) => ({ id: g.id, name: g.name }));

  return (
    <>
      <PageHeader title="Nova automação" description="Defina o que buscar, quando postar e onde. Nada é enviado até você ativar." />
      {active.length === 0 ? (
        <EmptyState
          icon={<IconPlug />}
          title="Nenhum grupo ativo"
          action={<Button href="/conexoes">Ir para Conexões</Button>}
        >
          Uma automação precisa de pelo menos um grupo do Telegram para postar. Conecte o bot e ative um grupo em Conexões.
        </EmptyState>
      ) : (
        <AutomationForm groups={active} automationsUsed={automations.length} maxAutomations={account.maxAutomations} dailyCap={account.dailyCapPerChannel} />
      )}
    </>
  );
}
