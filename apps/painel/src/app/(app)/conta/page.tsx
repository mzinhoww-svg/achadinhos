import { Cabecalho } from "@/components/cabecalho";
import { Card } from "@/components/ui/card";
import { exigirSessao } from "@/lib/auth";
import { FormSenha } from "./form";

export const dynamic = "force-dynamic";

export default async function Conta() {
  const sessao = await exigirSessao();
  return (
    <div className="flex flex-col gap-5">
      <Cabecalho titulo="Minha conta" descricao={`${sessao.nome} · ${sessao.email}`} />
      <Card className="p-5">
        <h2 className="mb-4 font-medium">Trocar senha</h2>
        <FormSenha />
      </Card>
    </div>
  );
}
