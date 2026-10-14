import { cx } from "@/lib/cx";

type Tone = "neutral" | "ok" | "warn" | "err" | "info" | "brand";

const tones: Record<Tone, { box: string; dot: string }> = {
  neutral: { box: "bg-sunken-2 text-ink-2", dot: "bg-ink-3" },
  ok: { box: "bg-ok-50 text-ok", dot: "bg-ok" },
  warn: { box: "bg-sun-50 text-sun-ink", dot: "bg-sun-ink" },
  err: { box: "bg-err-50 text-err", dot: "bg-err" },
  info: { box: "bg-info-50 text-info", dot: "bg-info" },
  brand: { box: "bg-brand-50 text-brand-700", dot: "bg-brand-600" },
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  const t = tones[tone];
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold leading-none", t.box, className)}>
      <span aria-hidden className={cx("size-1.5 rounded-full", t.dot)} />
      {children}
    </span>
  );
}

export type StatusKey =
  | "queued" | "sending" | "sent" | "failed" | "skipped"
  | "active" | "paused"
  | "connected" | "pending" | "error";

const statusMap: Record<StatusKey, { tone: Tone; label: string }> = {
  queued: { tone: "info", label: "Na fila" },
  sending: { tone: "brand", label: "Enviando" },
  sent: { tone: "ok", label: "Enviado" },
  failed: { tone: "err", label: "Falhou" },
  skipped: { tone: "neutral", label: "Ignorado" },
  active: { tone: "ok", label: "Ativa" },
  paused: { tone: "warn", label: "Pausada" },
  connected: { tone: "ok", label: "Conectada" },
  pending: { tone: "warn", label: "Pendente" },
  error: { tone: "err", label: "Com erro" },
};

/** Badge de status: sempre rótulo em texto, nunca só cor. */
export function StatusBadge({ status }: { status: StatusKey }) {
  const s = statusMap[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}
