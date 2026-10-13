import type { Metadata } from "next";
import { AutomationForm } from "@/components/automation-form";
import { PageHeader } from "@/components/ui/page-header";
import { account, automations, groups } from "@/lib/mock";

export const metadata: Metadata = { title: "Nova automação" };

export default function NovaAutomacaoPage() {
  return (
    <>
      <PageHeader title="Nova automação" description="Defina o que buscar, quando postar e onde. Nada é enviado até você ativar." />
      <AutomationForm
        groups={groups.filter((g) => g.active).map((g) => ({ id: g.id, name: g.name }))}
        automationsUsed={automations.length}
        maxAutomations={account.maxAutomations}
        dailyCap={account.dailyCapPerChannel}
      />
    </>
  );
}
