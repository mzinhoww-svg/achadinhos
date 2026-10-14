import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

export function Card({
  title,
  description,
  action,
  children,
  className,
  flush,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** Sem padding interno (tabelas encostam nas bordas). */
  flush?: boolean;
}) {
  return (
    <section className={cx("min-w-0 rounded-panel border border-line bg-bg", className)}>
      {(title || action) && (
        <header className={cx("flex items-start justify-between gap-3 px-5 pt-4", flush && "pb-3")}>
          <div className="min-w-0">
            {title && <h2 className="font-display text-lg font-bold leading-snug text-ink">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-ink-2">{description}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div className={cx(!flush && "px-5 pb-5", !flush && (title || action) ? "pt-4" : !flush && "pt-5")}>
        {children}
      </div>
    </section>
  );
}
