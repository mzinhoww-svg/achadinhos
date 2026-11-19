import type * as React from "react";

// Dois ícones no traço do Lucide, inline, para não instalar a biblioteca inteira.
const base = {
  xmlns: "http://www.w3.org/2000/svg",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export function IconeVoltar(props: React.ComponentProps<"svg">) {
  return (
    <svg aria-hidden="true" {...base} {...props}>
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

export function IconeDocumento(props: React.ComponentProps<"svg">) {
  return (
    <svg aria-hidden="true" {...base} {...props}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M10 9H8M16 13H8M16 17H8" />
    </svg>
  );
}
