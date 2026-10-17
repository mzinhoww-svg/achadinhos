import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GroupSwitch, ShopeeForm, TelegramForm } from "@/components/connections-forms";
import { StatusBadge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IconPlug } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable } from "@/components/ui/table";
import { conexoesEnabled } from "@/lib/flags";
import { formatDateTime, formatInt } from "@/lib/format";
import { isEmptyPreview } from "@/lib/mock";
import { container, viewSession } from "@/server/context";
import { getConnections } from "@/server/connections";

export const metadata: Metadata = { title: "Conexões" };

const statusOf = (s: "pending_validation" | "validated" | "invalid" | undefined) =>
  s === "validated" ? "connected" : s === "invalid" ? "error" : "pending";

export default async function ConexoesPage({ searchParams }: { searchParams: Promise<{ vazio?: string }> }) {
  // A flag é lida por requisição: `await searchParams` (como as demais telas) mantém a rota dinâmica,
  // senão o Next pré-renderiza o 404 e a rota fica presa mesmo com a flag ligada.
  const sp = await searchParams;
  // Tela dormente (T8-A): preservada, mas atrás da flag `ACHADINHOS_CONEXOES`.
  if (!conexoesEnabled()) notFound();
  const c = await container();
  const session = await viewSession(c, isEmptyPreview(sp));
  if (!session) {
    return (
      <>
        <PageHeader title="Conexões" description="Credenciais da Shopee e do Telegram." />
        <EmptyState icon={<IconPlug />} title="Sessão necessária">Entre na sua conta para gerenciar as conexões.</EmptyState>
      </>
    );
  }
  const { shopee, telegram } = await getConnections({ repo: c.connections, vault: c.vault, telegram: c.telegram }, session);
  const rows = telegram?.groups ?? [];

  return (
    <>
      <PageHeader title="Conexões" description="Credenciais da Shopee e do Telegram. Segredos ficam no cofre e nunca voltam para esta tela." />

      <div className="grid gap-6">
        <Card
          title="Shopee Afiliados"
          description={shopee?.validatedAt ? `Validada em ${formatDateTime(shopee.validatedAt)}` : "App ID e Secret da Open API de afiliados."}
          action={<StatusBadge status={statusOf(shopee?.status)} />}
        >
          <span id="shopee" className="relative -top-20 block" />
          {shopee?.lastError && <p role="alert" className="mb-3 text-sm text-err">{shopee.lastError}</p>}
          <ShopeeForm current={shopee} />
        </Card>

        <Card
          title="Telegram"
          description={telegram ? `Bot ${telegram.botName}` : "Crie um bot no @BotFather e adicione-o como admin nos grupos."}
          action={<StatusBadge status={statusOf(telegram?.status)} />}
        >
          <span id="telegram" className="relative -top-20 block" />
          <TelegramForm connected={!!telegram} />

          <div className="-mx-5 mt-6 -mb-5 border-t border-line">
            {rows.length === 0 ? (
              <div className="p-5">
                <EmptyState icon={<IconPlug />} title="Nenhum grupo encontrado">
                  Conecte o bot e adicione-o como administrador de um grupo. Os grupos aparecem aqui para você ativar.
                </EmptyState>
              </div>
            ) : (
              <DataTable
                caption="Grupos do Telegram"
                rows={rows}
                rowKey={(g) => g.id}
                columns={[
                  { key: "name", header: "Grupo", mobile: "title", cell: (g) => <span className="font-semibold">{g.name}</span> },
                  { key: "sub", header: "sub_id", cell: (g) => <code className="rounded bg-sunken-2 px-1.5 py-0.5 text-[0.8125rem]">{g.subId}</code> },
                  { key: "members", header: "Membros", align: "right", cell: (g) => formatInt(g.members) },
                  { key: "active", header: "Postar neste grupo", cell: (g) => <GroupSwitch groupId={g.id} name={g.name} active={g.active} /> },
                ]}
              />
            )}
          </div>
        </Card>
      </div>
    </>
  );
}
