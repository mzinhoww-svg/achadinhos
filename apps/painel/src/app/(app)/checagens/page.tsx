import Link from "next/link";
import { Cabecalho } from "@/components/cabecalho";
import { Confirmar } from "@/components/confirmar";
import { FaixaDemo } from "@/components/faixa-demo";
import { Filtros } from "@/components/filtros";
import { Card } from "@/components/ui/card";
import { Table, TBody, Td, THead, Th, Tr } from "@/components/ui/table";
import { HOJE, NICHOS, OFERTAS } from "@/lib/demo";

export default async function Checagens({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const f = await searchParams;
  const reprovadas = OFERTAS.filter((o) => o.status === "reprovada");
  const motivos = [...new Set(reprovadas.map((o) => o.motivo?.split(" (")[0] ?? ""))];
  const lista = reprovadas.filter(
    (o) => (!f.nicho || o.nicho === f.nicho) && (!f.motivo || o.motivo?.startsWith(f.motivo)),
  );
  const taxa = Math.round((HOJE.reprovadas / HOJE.avaliadas) * 100);
  return (
    <div className="flex flex-col gap-5">
      <Cabecalho titulo="Checagens" descricao="Ofertas que a checagem automática reprovou, com o motivo." />
      <FaixaDemo motivo="As reprovações reais chegam com /ofertas/:id/checar." />
      <Card className="flex items-center justify-between gap-3 p-4">
        <div>
          <p className="text-xs text-muted-foreground">Reprovação hoje</p>
          <p className="text-2xl font-semibold tabular-nums">{taxa}%</p>
        </div>
        <p className={taxa > 20 ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
          {taxa > 20 ? "Acima da trava de 20%: a operação pausa sozinha." : "Abaixo da trava de 20%."}
        </p>
      </Card>
      <Filtros
        valores={f}
        campos={[
          { nome: "motivo", rotulo: "Motivo", opcoes: motivos.map((m) => ({ valor: m, rotulo: m })) },
          { nome: "nicho", rotulo: "Nicho", opcoes: NICHOS.map((n) => ({ valor: n.nome, rotulo: n.nome })) },
        ]}
      />
      {lista.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">Nenhuma reprovação com esses filtros.</Card>
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>Oferta</Th>
              <Th>Motivo</Th>
              <Th>Agente</Th>
              <Th>Hora</Th>
              <Th className="text-right">Ação</Th>
            </Tr>
          </THead>
          <TBody>
            {lista.map((o) => (
              <Tr key={o.id}>
                <Td className="max-w-56">
                  <Link href={`/ofertas/${o.id}`} className="line-clamp-2 hover:underline">
                    {o.nome}
                  </Link>
                </Td>
                <Td className="min-w-48">{o.motivo}</Td>
                <Td>{o.agente}</Td>
                <Td>{o.horario}</Td>
                <Td className="text-right">
                  <Confirmar
                    variante="outline"
                    rotulo="Propor ajuste"
                    titulo="Propor ajuste de regra"
                    texto={`Cria uma proposta para CHECAGEM.md com o motivo "${o.motivo}" e esta oferta como exemplo. O Coordenador ou você aprova na Bíblia › Propostas. (Demonstração: nada é criado.)`}
                    confirmar="Criar proposta"
                  />
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
