import type { Metadata } from "next";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Switch } from "@/components/ui/form";
import { IconLock, IconPlug } from "@/components/ui/icons";
import { DataTable } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { formatDateTime, formatInt } from "@/lib/format";
import { groups, isEmptyPreview, shopee, telegram } from "@/lib/mock";

export const metadata: Metadata = { title: "Conexões" };

export default async function ConexoesPage({ searchParams }: { searchParams: Promise<{ vazio?: string }> }) {
  const empty = isEmptyPreview(await searchParams);
  const shopeeOk = !empty && shopee.status === "connected";
  const telegramOk = !empty && telegram.status === "connected";
  const rows = telegramOk ? groups : [];

  return (
    <>
      <PageHeader title="Conexões" description="Credenciais da Shopee e do Telegram. Segredos ficam no cofre e nunca voltam para esta tela." />

      <div className="grid gap-6">
        <Card
          title="Shopee Afiliados"
          description="App ID e Secret da Open API de afiliados."
          action={<StatusBadge status={shopeeOk ? "connected" : "pending"} />}
        >
          <span id="shopee" className="relative -top-20 block" />
          <form className="grid gap-4 sm:grid-cols-2" aria-label="Credenciais da Shopee">
            <Field label="App ID" htmlFor="app-id" hint={shopeeOk ? `Validada em ${formatDateTime(shopee.validatedAt)}` : "Número do aplicativo no painel de afiliados."}>
              <Input id="app-id" name="app_id" inputMode="numeric" autoComplete="off" placeholder="Ex.: 18350000000" defaultValue={shopeeOk ? shopee.appIdMasked : ""} />
            </Field>
            <Field
              label="Secret"
              htmlFor="secret"
              hint={
                <span className="inline-flex items-center gap-1.5">
                  <IconLock width={14} height={14} /> {shopeeOk ? "Guardado no cofre. Digite um novo valor apenas para trocar." : "Vai direto para o cofre e só o worker lê."}
                </span>
              }
            >
              <Input id="secret" name="secret" type="password" autoComplete="new-password" placeholder={shopeeOk ? "••••••••••••••••" : "Cole o Secret"} />
            </Field>
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <Button type="button">Validar e salvar</Button>
              {shopeeOk && <Button type="button" variant="danger">Remover credencial</Button>}
            </div>
          </form>
        </Card>

        <Card
          title="Telegram"
          description={telegramOk ? `Bot ${telegram.botName}` : "Crie um bot no @BotFather e adicione-o como admin nos grupos."}
          action={<StatusBadge status={telegramOk ? "connected" : "pending"} />}
        >
          <span id="telegram" className="relative -top-20 block" />
          <form className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end" aria-label="Token do bot do Telegram">
            <Field label="Token do bot" htmlFor="bot-token" hint="Guardado no cofre; não é exibido depois de salvo.">
              <Input id="bot-token" name="bot_token" type="password" autoComplete="new-password" placeholder={telegramOk ? "••••••••••••••••" : "Cole o token do bot"} />
            </Field>
            <Button type="button" variant="secondary">Validar bot</Button>
          </form>

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
                  { key: "active", header: "Postar neste grupo", cell: (g) => <Switch label={g.active ? "Ativo" : "Inativo"} defaultChecked={g.active} aria-label={`Ativar ${g.name}`} /> },
                ]}
              />
            )}
          </div>
        </Card>
      </div>
    </>
  );
}
