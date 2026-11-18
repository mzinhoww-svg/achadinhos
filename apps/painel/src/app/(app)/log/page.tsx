import Link from "next/link";
import { Cabecalho } from "@/components/cabecalho";
import { worker } from "@/lib/worker";
import { LogAoVivo } from "./ao-vivo";

export const dynamic = "force-dynamic";

export default async function Log() {
  const { eventos } = await worker.listarEventos(100);
  return (
    <div className="flex flex-col gap-5">
      <Cabecalho
        titulo="Log dos agentes"
        descricao="Tudo o que acontece, em tempo real. Toda ação dos agentes vira evento no worker."
        acao={
          <Link href="/log/auditoria" className="text-sm text-primary hover:underline">
            Auditoria do painel
          </Link>
        }
      />
      <LogAoVivo iniciais={eventos} />
    </div>
  );
}
