import Link from "next/link";
import { Button } from "@/components/ui/button";
import { exigirSessao } from "@/lib/auth";
import { sair } from "../login/acoes";

export const dynamic = "force-dynamic";

export default async function LayoutApp({ children }: { children: React.ReactNode }) {
  const sessao = await exigirSessao();
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-4">
          <nav className="flex items-center gap-4">
            <Link href="/biblia" className="font-semibold text-primary">
              Achadinhos
            </Link>
            <Link href="/biblia" className="text-sm text-muted-foreground hover:text-foreground">
              Bíblia
            </Link>
          </nav>
          <form action={sair} className="flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">{sessao.nome}</span>
            <Button type="submit" variant="ghost" size="sm">
              Sair
            </Button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
