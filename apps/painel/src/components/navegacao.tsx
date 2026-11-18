"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export const TELAS = [
  { href: "/", rotulo: "Visão geral" },
  { href: "/ofertas", rotulo: "Ofertas" },
  { href: "/checagens", rotulo: "Checagens" },
  { href: "/nichos", rotulo: "Nichos" },
  { href: "/grupos", rotulo: "Grupos" },
  { href: "/chips", rotulo: "Chips do WhatsApp" },
  { href: "/numeros", rotulo: "Números" },
  { href: "/links", rotulo: "Links e cliques" },
  { href: "/conversoes", rotulo: "Conversões" },
  { href: "/biblia", rotulo: "Bíblia" },
  { href: "/log", rotulo: "Log dos agentes" },
] as const;

function ativa(caminho: string, href: string) {
  return href === "/" ? caminho === "/" : caminho === href || caminho.startsWith(`${href}/`);
}

function Lista({ caminho, aoEscolher }: { caminho: string; aoEscolher?: () => void }) {
  return (
    <ul className="flex flex-col gap-0.5">
      {TELAS.map((t) => (
        <li key={t.href}>
          <Link
            href={t.href}
            onClick={aoEscolher}
            aria-current={ativa(caminho, t.href) ? "page" : undefined}
            className={cn(
              "block rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground",
              ativa(caminho, t.href) && "bg-accent font-medium text-foreground",
            )}
          >
            {t.rotulo}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Barra lateral fixa no computador. */
export function BarraLateral() {
  const caminho = usePathname();
  return (
    <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-56 shrink-0 overflow-y-auto border-r p-3 lg:block">
      <Lista caminho={caminho} />
    </aside>
  );
}

/** Menu lateral no celular (botão no topo). */
export function MenuCelular() {
  const caminho = usePathname();
  const [aberto, setAberto] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: fecha ao trocar de tela.
  useEffect(() => setAberto(false), [caminho]);
  return (
    <div className="lg:hidden">
      <button
        type="button"
        aria-label="Abrir menu"
        aria-expanded={aberto}
        onClick={() => setAberto(true)}
        className="-ml-2 flex size-10 items-center justify-center rounded-md hover:bg-accent"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="size-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
      {/* Portal no body: o backdrop-blur do cabeçalho prenderia um "fixed" dentro dele. */}
      {aberto
        ? createPortal(
            <div className="fixed inset-0 z-50">
              <button
                type="button"
                aria-label="Fechar menu"
                className="absolute inset-0 bg-black/40"
                onClick={() => setAberto(false)}
              />
              <nav className="absolute inset-y-0 left-0 w-72 max-w-[85vw] overflow-y-auto bg-background p-3 shadow-xl">
                <p className="px-3 py-2 font-semibold text-primary">Achadinhos</p>
                <Lista caminho={caminho} aoEscolher={() => setAberto(false)} />
              </nav>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
