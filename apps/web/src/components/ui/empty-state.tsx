import type { ReactNode } from "react";

/** Estado vazio ensina o próximo passo: título diz o que falta, texto diz por quê, ação resolve. */
export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-panel border border-dashed border-line-strong bg-sunken px-6 py-12 text-center">
      {icon && <div className="mb-4 grid size-12 place-items-center rounded-full bg-brand-50 text-brand-600">{icon}</div>}
      <h3 className="font-display text-xl font-bold text-ink">{title}</h3>
      {children && <p className="mt-1.5 max-w-[46ch] text-[0.9375rem] leading-relaxed text-ink-2">{children}</p>}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}
