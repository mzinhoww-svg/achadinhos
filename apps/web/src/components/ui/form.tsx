import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cx } from "@/lib/cx";

const control =
  "w-full rounded-control border border-line-strong bg-bg px-3 text-[0.9375rem] text-ink placeholder:text-ink-3 " +
  "transition-colors duration-150 hover:border-ink-3 focus-visible:border-brand-600 focus-visible:outline-brand-600 " +
  "disabled:cursor-not-allowed disabled:bg-sunken disabled:text-ink-3 aria-[invalid=true]:border-err";

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-sm font-semibold text-ink">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-msg`} role="alert" aria-live="assertive" className="text-sm text-err">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${htmlFor}-msg`} className="text-sm text-ink-2">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(control, "h-11", className)} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(control, "h-11 appearance-none bg-[length:1rem] bg-[right_0.75rem_center] bg-no-repeat pr-9", className)}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%236c5f67' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M6 9l6 6 6-6'/></svg>\")",
      }}
      {...rest}
    >
      {children}
    </select>
  );
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(control, "min-h-24 py-2.5 leading-relaxed", className)} {...rest} />;
}

/** Interruptor acessível (checkbox nativo com role=switch). */
export function Switch({ label, className, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: string }) {
  return (
    <label className={cx("inline-flex cursor-pointer items-center gap-2.5 text-sm font-medium text-ink", className)}>
      <input type="checkbox" role="switch" className="peer sr-only" {...rest} />
      <span
        aria-hidden
        className={cx(
          "relative h-6 w-10 shrink-0 rounded-full bg-line-strong transition-colors duration-150",
          "peer-checked:bg-brand-600 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-500",
          "after:absolute after:left-0.5 after:top-0.5 after:size-5 after:rounded-full after:bg-white after:shadow-sm",
          "after:transition-transform after:duration-150 peer-checked:after:translate-x-4",
        )}
      />
      <span>{label}</span>
    </label>
  );
}

/** Chip alternável (dias da semana, categorias). */
export function Chip({ label, className, type = "checkbox", ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className={cx("cursor-pointer", className)}>
      <input type={type} className="peer sr-only" {...rest} />
      <span
        className={cx(
          "inline-flex h-10 min-w-12 items-center justify-center rounded-control border border-line-strong bg-bg px-3 text-sm font-semibold text-ink-2",
          "transition-colors duration-150 hover:border-ink-3",
          "peer-checked:border-brand-600 peer-checked:bg-brand-50 peer-checked:text-brand-700",
          "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-500",
        )}
      >
        {label}
      </span>
    </label>
  );
}
