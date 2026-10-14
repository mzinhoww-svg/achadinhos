import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "@/lib/cx";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const variants: Record<Variant, string> = {
  primary:
    "bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-700 disabled:bg-line-strong disabled:text-ink-3",
  secondary:
    "bg-bg text-ink border border-line-strong hover:bg-sunken hover:border-ink-3 active:bg-sunken-2 disabled:text-ink-3 disabled:bg-sunken",
  ghost: "bg-transparent text-ink-2 hover:bg-sunken-2 active:bg-line disabled:text-ink-3",
  danger: "bg-bg text-err border border-err/40 hover:bg-err-50 active:bg-err-50 disabled:text-ink-3 disabled:border-line",
};
const sizes: Record<Size, string> = {
  sm: "h-9 px-3 text-sm gap-1.5",
  md: "h-11 px-4 text-[0.9375rem] gap-2",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  href?: string;
  icon?: ReactNode;
}

export function Button({ variant = "primary", size = "md", loading, href, icon, className, children, disabled, ...rest }: ButtonProps) {
  const classes = cx(
    "inline-flex items-center justify-center rounded-control font-semibold whitespace-nowrap select-none",
    "transition-colors duration-150 disabled:cursor-not-allowed",
    variants[variant],
    sizes[size],
    className,
  );
  const content = (
    <>
      {loading ? (
        <span
          aria-hidden
          className="size-4 rounded-full border-2 border-current border-t-transparent"
          style={{ animation: "spin 0.7s linear infinite" }}
        />
      ) : (
        icon
      )}
      {children}
    </>
  );
  if (href && !disabled) {
    return (
      <Link href={href} className={classes}>
        {content}
      </Link>
    );
  }
  return (
    <button className={classes} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {content}
    </button>
  );
}
