import type { Metadata } from "next";
import { AutomationForm } from "@/components/automation-form";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IconPlug } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { conexoesEnabled } from "@/lib/flags";
import { account, isEmptyPreview } from "@/lib/mock";
import { container, viewSession } from "@/server/context";

export const metadata: Metadata = { title: "Nova automação" };

export default async function NovaAutomacaoPage({ searchParams }: { searchParams: Promise<{ vazio?: string }> }) {
  const c = await container();
  const session = await viewSession(c, isEmptyPreview(await searchParams));
  // R1: sem a flag, nenhum CTA aponta para /conexoes (que responde 404).
  const showConexoes = conexoesEnabled();
  const active = session ? (await c.connections.listGroups(session.accountId)).filter((g) => g.active).map((g) => ({ id: g.id, name: g.name })) : [];
  const used = session ? (await c.automations.list(session.accountId)).length : 0;

  return (
    <>
      <PageHeader title="Nova automação" description="Defina o que buscar, quando postar e onde. Nada é enviado até você ativar." />
      {active.length === 0 ? (
        <EmptyState
          icon={<IconPlug />}
          title="Nenhum grupo ativo"
          action={showConexoes ? <Button href="/conexoes">Ir para Conexões</Button> : undefined}
        >
          {showConexoes
            ? "Uma automação precisa de pelo menos um grupo do Telegram para postar. Conecte o bot e ative um grupo em Conexões."
            : "Os destinos agora são a pasta outbox; o envio por WhatsApp vem depois."}
        </EmptyState>
      ) : (
        <AutomationForm groups={active} automationsUsed={used} maxAutomations={account.maxAutomations} dailyCap={account.dailyCapPerChannel} />
      )}
    </>
  );
}
