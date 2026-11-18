import Link from "next/link";
import { BarraLateral, MenuCelular } from "@/components/navegacao";
import { Button } from "@/components/ui/button";
import { exigirSessao } from "@/lib/auth";
import { sair } from "../login/acoes";

export const dynamic = "force-dynamic";

export default async function LayoutApp({ children }: { children: React.ReactNode }) {
  const sessao = await exigirSessao();
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur">
        <div className="flex h-14 items-center justify-between gap-3 px-4">
          <div className="flex items-center gap-2">
            <MenuCelular />
            <Link href="/" className="font-semibold text-primary">
              Achadinhos
            </Link>
          </div>
          <form action={sair} className="flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">{sessao.nome}</span>
            <Button type="submit" variant="ghost" size="sm">
              Sair
            </Button>
          </form>
        </div>
      </header>
      <div className="flex">
        <BarraLateral />
        <main className="mx-auto w-full max-w-5xl min-w-0 px-4 py-6">{children}</main>
      </div>
    </div>
  );
}
