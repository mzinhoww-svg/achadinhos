import type { Metadata } from "next";
import { SendNowPanel } from "@/components/send-now-panel";
import { EmptyState } from "@/components/ui/empty-state";
import { IconSend } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { conexoesEnabled } from "@/lib/flags";
import { isEmptyPreview } from "@/lib/mock";
import { getConnections } from "@/server/connections";
import { container, viewSession } from "@/server/context";

export const metadata: Metadata = { title: "Mandar agora" };

export default async function MandarAgoraPage({ searchParams }: { searchParams: Promise<{ vazio?: string }> }) {
  const c = await container();
  const session = await viewSession(c, isEmptyPreview(await searchParams));
  // R1: sem a flag, nenhum CTA aponta para /conexoes (que responde 404).
  const showConexoes = conexoesEnabled();
  const header = <PageHeader title="Mandar agora" description="Envie uma oferta específica agora, fora da programação das automações." />;
  if (!session) {
    return (
      <>
        {header}
        <EmptyState icon={<IconSend />} title="Sessão necessária">Entre na sua conta para mandar ofertas.</EmptyState>
      </>
    );
  }
  const { telegram } = await getConnections({ repo: c.connections, vault: c.vault, telegram: c.telegram }, session);
  const groups = (telegram?.groups ?? []).map((g) => ({ id: g.id, name: g.name, active: g.active }));
  return (
    <>
      {header}
      <SendNowPanel groups={groups} showConexoes={showConexoes} />
    </>
  );
}
