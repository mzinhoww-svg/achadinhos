"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, type ComponentType, type SVGProps } from "react";
import { cx } from "@/lib/cx";
import { IconBolt, IconEye, IconHome, IconPlug, IconSend, IconTag } from "@/components/ui/icons";

type NavItem = {
  href: string;
  label: string;
  short: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Tela dormente (T8-A): só aparece com a flag `ACHADINHOS_CONEXOES` ligada. */
  flag?: "conexoes";
};

const ITEMS: readonly NavItem[] = [
  { href: "/painel", label: "Painel", short: "Painel", Icon: IconHome },
  { href: "/conexoes", label: "Conexões", short: "Conexões", Icon: IconPlug, flag: "conexoes" },
  { href: "/automacoes", label: "Automações", short: "Automações", Icon: IconBolt },
  { href: "/ofertas", label: "Ofertas", short: "Ofertas", Icon: IconTag },
  { href: "/envios", label: "Envios", short: "Envios", Icon: IconSend },
];

/** "Mandar agora" aparece só na barra lateral; no celular a barra inferior tem as abas e o atalho fica em Envios. */
const MANDAR_AGORA: NavItem = { href: "/mandar-agora", label: "Mandar agora", short: "Mandar", Icon: IconBolt };

/** Conexões/Telegram é tela dormente (T8-A): some do menu sem a flag, mas a rota continua no repositório. */
function visibleItems(showConexoes: boolean): NavItem[] {
  return ITEMS.filter((i) => i.flag !== "conexoes" || showConexoes);
}

function sideItems(showConexoes: boolean): NavItem[] {
  const base = visibleItems(showConexoes);
  const envios = base.filter((i) => i.href === "/envios");
  const rest = base.filter((i) => i.href !== "/envios");
  return [...rest, MANDAR_AGORA, ...envios];
}

function useActive() {
  const pathname = usePathname();
  return (href: string) => pathname === href || pathname.startsWith(`${href}/`);
}

function EmptyToggle() {
  const pathname = usePathname();
  const sp = useSearchParams();
  const on = sp.get("vazio") === "1";
  const next = new URLSearchParams(sp.toString());
  if (on) next.delete("vazio");
  else next.set("vazio", "1");
  const qs = next.toString();
  return (
    <Link
      href={`${pathname}${qs ? `?${qs}` : ""}`}
      className="flex items-center gap-2 rounded-control px-3 py-2 text-sm font-medium text-ink-2 hover:bg-sunken-2"
    >
      <IconEye width={18} height={18} />
      {on ? "Voltar aos dados de exemplo" : "Ver estados vazios"}
    </Link>
  );
}

export function SideNav({ showConexoes }: { showConexoes: boolean }) {
  const isActive = useActive();
  return (
    <nav aria-label="Principal" className="flex h-full flex-col gap-1">
      {sideItems(showConexoes).map(({ href, label, Icon }) => {
        const active = isActive(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "flex items-center gap-3 rounded-control px-3 py-2.5 text-[0.9375rem] font-semibold transition-colors duration-150",
              active ? "bg-brand-50 text-brand-700" : "text-ink-2 hover:bg-sunken-2 hover:text-ink",
            )}
          >
            <Icon />
            {label}
          </Link>
        );
      })}
      <div className="mt-auto border-t border-line pt-3">
        <Suspense fallback={null}>
          <EmptyToggle />
        </Suspense>
      </div>
    </nav>
  );
}

export function TabBar({ showConexoes }: { showConexoes: boolean }) {
  const isActive = useActive();
  const items = visibleItems(showConexoes);
  return (
    <nav
      aria-label="Principal"
      className={cx(
        "fixed inset-x-0 bottom-0 z-[var(--z-nav)] grid border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm lg:hidden",
        items.length === 5 ? "grid-cols-5" : "grid-cols-4",
      )}
    >
      {items.map(({ href, short, Icon }) => {
        const active = isActive(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "flex min-h-14 flex-col items-center justify-center gap-0.5 text-[0.6875rem] font-semibold",
              active ? "text-brand-700" : "text-ink-3",
            )}
          >
            <Icon width={22} height={22} strokeWidth={active ? 2.1 : 1.75} />
            {short}
          </Link>
        );
      })}
    </nav>
  );
}
