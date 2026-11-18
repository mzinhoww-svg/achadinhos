import Link from "next/link";
import { BotaoPausa } from "@/components/botao-pausa";
import { BarraLateral, MenuCelular } from "@/components/navegacao";
import { StatusDot } from "@/components/status-dot";
import { Button } from "@/components/ui/button";
import { exigirSessao } from "@/lib/auth";
import { worker } from "@/lib/worker";
import { sair } from "../login/acoes";

export const dynamic = "force-dynamic";

export default async function LayoutApp({ children }: { children: React.ReactNode }) {
  const sessao = await exigirSessao();
  const pausa = await worker.pausa().catch(() => null);
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
          <div className="flex items-center gap-2">
            {pausa ? (
              <>
                <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
                  <StatusDot tipo={pausa.pausado ? "aviso" : "ok"} />
                  {pausa.pausado ? "Pausado" : "Rodando"}
                </span>
                <BotaoPausa pausado={pausa.pausado} />
              </>
            ) : (
              <span className="text-xs text-muted-foreground">worker fora do ar</span>
            )}
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
