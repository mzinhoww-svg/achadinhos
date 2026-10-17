import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/logo";
import { SideNav, TabBar } from "@/components/nav";
import { conexoesEnabled } from "@/lib/flags";
import { account } from "@/lib/mock";

export function AppShell({ children }: { children: ReactNode }) {
  // Conexões/Telegram é tela dormente (T8-A): sem a flag some do menu. A rota continua no repositório.
  const showConexoes = conexoesEnabled();
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col gap-6 border-r border-line bg-sunken px-3 py-5 lg:flex">
        <Link href="/painel" className="px-3" aria-label="achadinhos — painel">
          <Logo />
        </Link>
        <div className="min-h-0 flex-1">
          <SideNav showConexoes={showConexoes} />
        </div>
        <p className="px-3 text-xs text-ink-3">Conta {account.handle}</p>
      </aside>

      <header className="sticky top-0 z-[var(--z-sticky)] flex h-14 items-center justify-between border-b border-line bg-bg px-4 lg:hidden">
        <Link href="/painel" aria-label="achadinhos — painel">
          <Logo />
        </Link>
        <span className="text-xs text-ink-3">{account.handle}</span>
      </header>

      <main className="min-w-0 px-4 pb-28 pt-6 sm:px-6 lg:px-10 lg:pb-12 lg:pt-8">
        <div className="mx-auto max-w-[68rem]">{children}</div>
      </main>
      <TabBar showConexoes={showConexoes} />
    </div>
  );
}
