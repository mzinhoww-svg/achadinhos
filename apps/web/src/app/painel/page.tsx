import type { Metadata } from "next";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IconAlert, IconArrow, IconBolt, IconCheck, IconClock, IconSend } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { cx } from "@/lib/cx";
import { formatInt, formatTime } from "@/lib/format";
import { account, isEmptyPreview } from "@/lib/mock";
import { getConnections } from "@/server/connections";
import { container, viewSession } from "@/server/context";
import { getEnvios } from "@/server/envios";
import { getOnboarding, type StepState } from "@/server/onboarding";

export const metadata: Metadata = { title: "Painel" };

const STATE_LABEL: Record<StepState, string | null> = { done: null, pending: "Validando", error: "Com erro", todo: null, blocked: "Aguardando passo anterior" };

export default async function PainelPage({ searchParams }: { searchParams: Promise<{ vazio?: string }> }) {
  const sp = await searchParams;
  const empty = isEmptyPreview(sp);
  const withVazio = empty ? "?vazio=1" : "";
  const c = await container();
  const session = await viewSession(c, empty);
  const header = <PageHeader title="Painel" description="Visão do dia: o que já saiu, o que está na fila e o que precisa de atenção." />;
  if (!session) {
    return (
      <>
        {header}
        <EmptyState icon={<IconBolt />} title="Sessão necessária">Entre na sua conta para ver o painel.</EmptyState>
      </>
    );
  }

  const [onboarding, envios, conns] = await Promise.all([
    getOnboarding({ connections: c.connections, automations: c.automations }, session),
    getEnvios({ sends: c.sends }, session, {}),
    getConnections({ repo: c.connections, vault: c.vault, telegram: c.telegram }, session),
  ]);
  const { steps, doneCount, total, next, complete } = onboarding;
  const nextStep = steps.find((s) => s.key === next);
  const upcoming = envios.items.filter((s) => s.status === "queued" || s.status === "sending").slice(0, 5);
  const attention = envios.items.filter((s) => s.status === "failed").slice(0, 5);
  const activeGroups = conns.telegram?.groups.filter((g) => g.active).length ?? 0;

  return (
    <>
      <PageHeader
        title="Painel"
        description="Visão do dia: o que já saiu, o que está na fila e o que precisa de atenção."
        actions={<Button href="/automacoes/nova" icon={<IconBolt width={18} height={18} />}>Nova automação</Button>}
      />

      <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
        <Card
          title={complete ? "Tudo pronto para postar" : "Comece por aqui"}
          description={`${doneCount} de ${total} passos concluídos`}
          action={nextStep && <Button href={`${nextStep.href}`} size="sm" icon={<IconArrow width={16} height={16} />}>Continuar</Button>}
        >
          <div className="h-2 overflow-hidden rounded-full bg-sunken-2" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={doneCount} aria-label="Progresso da configuração">
            <div className="h-full rounded-full bg-brand-600" style={{ width: `${(doneCount / total) * 100}%` }} />
          </div>
          <ol className="mt-4 divide-y divide-line">
            {steps.map((s, i) => {
              const isNext = s.key === next;
              const label = STATE_LABEL[s.state];
              return (
                <li key={s.key}>
                  <a href={`${s.href.split("#")[0]}${withVazio}${s.href.includes("#") ? `#${s.href.split("#")[1]}` : ""}`} className="group -mx-2 flex items-start gap-3 rounded-control px-2 py-3 hover:bg-sunken">
                    <span
                      className={cx(
                        "mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold",
                        s.state === "done" ? "bg-ok text-white" : s.state === "error" ? "bg-err text-white" : isNext ? "bg-brand-600 text-white" : "border border-line-strong text-ink-3",
                      )}
                    >
                      {s.state === "done" ? <IconCheck width={14} height={14} strokeWidth={3} /> : s.state === "error" ? "!" : s.state === "pending" ? <IconClock width={14} height={14} /> : i + 1}
                    </span>
                    <span className="min-w-0">
                      <span className={cx("flex flex-wrap items-center gap-2 text-[0.9375rem] font-semibold", s.state === "done" ? "text-ink-3" : "text-ink")}>
                        {s.title}
                        {label && <Badge tone={s.state === "error" ? "err" : s.state === "pending" ? "info" : "neutral"}>{label}</Badge>}
                      </span>
                      <span className="block text-sm text-ink-2">{s.detail ?? s.text}</span>
                    </span>
                  </a>
                </li>
              );
            })}
          </ol>
        </Card>

        <Card title="Hoje" description={`Fuso ${envios.timeZone}`}>
          <dl>
            <Stat label="Enviados hoje" value={formatInt(envios.today.sent)} note={`teto ${account.dailyCapPerChannel}/canal`} />
            <Stat label="Na fila" value={formatInt(envios.today.queued)} note="1 por vez por canal" />
            <Stat label="Falhas hoje" value={formatInt(envios.today.failed)} note="não reenviam sozinhas" />
            <Stat label="Grupos ativos" value={formatInt(activeGroups)} note="no Telegram" />
          </dl>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.35fr_1fr]">
        <Card title="Próximos envios" flush action={<Button href={`/envios${withVazio}`} variant="ghost" size="sm">Ver todos</Button>}>
          {upcoming.length === 0 ? (
            <div className="px-5 pb-5">
              <EmptyState icon={<IconSend />} title="Nada na fila agora" action={<Button href="/automacoes/nova" variant="secondary">Criar automação</Button>}>
                Quando uma automação estiver ativa e dentro da janela, as ofertas aparecem aqui antes de sair.
              </EmptyState>
            </div>
          ) : (
            <ul className="divide-y divide-line border-t border-line">
              {upcoming.map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">{s.offerTitle ?? "Oferta removida"}</p>
                    <p className="text-sm text-ink-2">
                      {s.groupName ?? "Grupo removido"} · {formatTime(s.at)} · {s.origin}
                    </p>
                  </div>
                  <StatusBadge status={s.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Precisa de atenção">
          {attention.length === 0 ? (
            <p className="flex items-center gap-2 text-[0.9375rem] text-ink-2">
              <Badge tone="ok" className="shrink-0 whitespace-nowrap">Tudo certo</Badge> Nenhuma falha recente nos envios.
            </p>
          ) : (
            <ul className="space-y-3">
              {attention.map((s) => (
                <li key={s.id} className="flex gap-3 rounded-control bg-err-50 p-3">
                  <IconAlert className="mt-0.5 shrink-0 text-err" />
                  <div className="min-w-0 text-sm">
                    <p className="font-semibold text-ink">{s.offerTitle ?? "Oferta removida"}</p>
                    <p className="text-ink-2">{s.reason ?? "Falha sem detalhe."}</p>
                    <p className="mt-1.5 text-xs text-ink-3">Falhas não são reenviadas automaticamente.</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-3 first:pt-0 last:border-b-0 last:pb-0">
      <div className="min-w-0">
        <dt className="text-[0.9375rem] font-semibold text-ink">{label}</dt>
        <dd className="text-xs text-ink-3">{note}</dd>
      </div>
      <dd className="font-display text-xl font-bold tabular-nums text-ink">{value}</dd>
    </div>
  );
}
