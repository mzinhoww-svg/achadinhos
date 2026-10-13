import type { Metadata } from "next";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IconAlert, IconArrow, IconBolt, IconCheck, IconSend } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { ProductThumb } from "@/components/product-thumb";
import { cx } from "@/lib/cx";
import { formatBRL, formatInt, formatTime } from "@/lib/format";
import { account, automations, groups, isEmptyPreview, offerById, sends, shopee, telegram } from "@/lib/mock";

export const metadata: Metadata = { title: "Painel" };

export default async function PainelPage({ searchParams }: { searchParams: Promise<{ vazio?: string }> }) {
  const empty = isEmptyPreview(await searchParams);
  const withVazio = empty ? "?vazio=1" : "";

  const steps = [
    { key: "shopee", title: "Conectar a Shopee", text: "App ID e Secret do programa de afiliados.", href: `/conexoes${withVazio}#shopee`, done: !empty && shopee.status === "connected" },
    { key: "telegram", title: "Conectar o Telegram", text: "Token do bot e os grupos onde ele é admin.", href: `/conexoes${withVazio}#telegram`, done: !empty && telegram.status === "connected" },
    { key: "grupo", title: "Ativar um grupo", text: "Cada grupo ganha um sub_id para medir comissão.", href: `/conexoes${withVazio}#telegram`, done: !empty && groups.some((g) => g.active) },
    { key: "automacao", title: "Criar a primeira automação", text: "Filtros, janela e frequência de postagem.", href: "/automacoes/nova", done: !empty && automations.length > 0 },
    { key: "envio", title: "Acompanhar o primeiro envio", text: "Veja o post na fila e confira no grupo.", href: `/envios${withVazio}`, done: !empty && sends.some((s) => s.status === "sent") },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done);

  const upcoming = empty ? [] : sends.filter((s) => s.status === "queued" || s.status === "sending");
  const attention = empty ? [] : sends.filter((s) => s.status === "failed");
  const sentToday = empty ? 0 : sends.filter((s) => s.status === "sent").length;

  return (
    <>
      <PageHeader
        title="Painel"
        description="Visão do dia: o que já saiu, o que está na fila e o que precisa de atenção."
        actions={<Button href="/automacoes/nova" icon={<IconBolt width={18} height={18} />}>Nova automação</Button>}
      />

      <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
        <Card
          title={doneCount === steps.length ? "Tudo pronto para postar" : "Comece por aqui"}
          description={`${doneCount} de ${steps.length} passos concluídos`}
          action={next && <Button href={next.href} size="sm" icon={<IconArrow width={16} height={16} />}>Continuar</Button>}
        >
          <div className="h-2 overflow-hidden rounded-full bg-sunken-2" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={doneCount} aria-label="Progresso da configuração">
            <div className="h-full rounded-full bg-brand-600" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
          </div>
          <ol className="mt-4 divide-y divide-line">
            {steps.map((s, i) => (
              <li key={s.key}>
                <a href={s.href} className="group -mx-2 flex items-start gap-3 rounded-control px-2 py-3 hover:bg-sunken">
                  <span
                    className={cx(
                      "mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold",
                      s.done ? "bg-ok text-white" : s === next ? "bg-brand-600 text-white" : "border border-line-strong text-ink-3",
                    )}
                  >
                    {s.done ? <IconCheck width={14} height={14} strokeWidth={3} /> : i + 1}
                  </span>
                  <span className="min-w-0">
                    <span className={cx("block text-[0.9375rem] font-semibold", s.done ? "text-ink-3 line-through decoration-1" : "text-ink")}>{s.title}</span>
                    <span className="block text-sm text-ink-2">{s.text}</span>
                  </span>
                </a>
              </li>
            ))}
          </ol>
        </Card>

        <Card title="Hoje" description={`Fuso ${account.timezone}`}>
          <dl>
            <Stat label="Enviados" value={formatInt(sentToday)} note={`teto ${account.dailyCapPerChannel}/canal`} />
            <Stat label="Na fila" value={formatInt(upcoming.length)} note="1 por vez por canal" />
            <Stat label="Grupos ativos" value={formatInt(empty ? 0 : groups.filter((g) => g.active).length)} note="no Telegram" />
            <Stat label="Comissão estimada" value={empty ? "—" : formatBRL(46.3)} note="7 dias · conversionReport" />
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
              {upcoming.map((s) => {
                const o = offerById(s.offerId);
                return (
                  <li key={s.id} className="flex items-center gap-3 px-5 py-3">
                    <ProductThumb offer={o} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink">{o.title}</p>
                      <p className="text-sm text-ink-2">
                        {groups.find((g) => g.id === s.groupId)?.name} · {formatTime(s.scheduledFor)}
                        {s.priority === 100 && " · prioridade máxima"}
                      </p>
                    </div>
                    <StatusBadge status={s.status} />
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card title="Precisa de atenção">
          {attention.length === 0 ? (
            <p className="flex items-center gap-2 text-[0.9375rem] text-ink-2">
              <Badge tone="ok">Tudo certo</Badge> Nenhuma falha recente nos envios.
            </p>
          ) : (
            <ul className="space-y-3">
              {attention.map((s) => (
                <li key={s.id} className="flex gap-3 rounded-control bg-err-50 p-3">
                  <IconAlert className="mt-0.5 shrink-0 text-err" />
                  <div className="min-w-0 text-sm">
                    <p className="font-semibold text-ink">{offerById(s.offerId).title}</p>
                    <p className="text-ink-2">{s.reason}</p>
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
