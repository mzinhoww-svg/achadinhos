import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  align?: "left" | "right";
  /** No mobile (<md) vira cartão: "title" = linha principal; "meta" = linhas rotuladas; "hide" = omitido. */
  mobile?: "title" | "meta" | "hide";
  className?: string;
}

/** Tabela em ≥md; lista de cartões compactos em <md (sem rolagem horizontal). */
export function DataTable<T>({ columns, rows, rowKey, caption }: { columns: Column<T>[]; rows: T[]; rowKey: (row: T) => string; caption: string }) {
  const title = columns.find((c) => c.mobile === "title") ?? columns[0]!;
  const meta = columns.filter((c) => c !== title && c.mobile !== "hide");
  return (
    <>
      <div className="hidden md:block">
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-y border-line bg-sunken">
              {columns.map((c) => (
                <th key={c.key} scope="col" className={cx("px-4 py-2.5 text-xs font-semibold text-ink-2", c.align === "right" && "text-right")}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={rowKey(row)} className="border-b border-line last:border-b-0 hover:bg-sunken/60">
                {columns.map((c) => (
                  <td key={c.key} className={cx("px-4 py-3 align-middle text-ink", c.align === "right" && "text-right tabular-nums", c.className)}>
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-line border-t border-line md:hidden">
        {rows.map((row) => (
          <li key={rowKey(row)} className="px-4 py-3.5">
            <div className="font-semibold text-ink">{title.cell(row)}</div>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              {meta.map((c) => (
                <div key={c.key} className="contents">
                  <dt className="text-ink-3">{c.header}</dt>
                  <dd className="min-w-0 text-ink">{c.cell(row)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}
