import Link from "next/link";
import { Cabecalho } from "@/components/cabecalho";
import { Kpi } from "@/components/kpi";
import { Periodo } from "@/components/periodo";
import { Table, TBody, Td, THead, Th, Tr } from "@/components/ui/table";
import { brl, type Conversao } from "@/lib/tipos";
import { worker } from "@/lib/worker";

export const dynamic = "force-dynamic";
const DIAS: Record<string, number> = { hoje: 1, "7d": 7, "30d": 30 };

export default async function Conversoes({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const f = await searchParams;
  const periodo = f.periodo && DIAS[f.periodo] ? f.periodo : "30d";
  const { conversoes } = await worker.get<{ conversoes: Conversao[] }>(`/conversoes?dias=${DIAS[periodo]}`);
  const comissao = conversoes.reduce((a, c) => a + Number(c.comissao ?? 0), 0);
  const vendas = conversoes.reduce((a, c) => a + Number(c.valor ?? 0), 0);
  return (
    <div className="flex flex-col gap-5">
      <Cabecalho
        titulo="Conversões"
        descricao="Vendas que vieram dos links, ligadas à oferta e ao grupo pelos subIds. A Shopee manda o relatório uma vez por dia."
      />
      <Periodo base="/conversoes" atual={periodo} />
      <div className="grid grid-cols-3 gap-3">
        <Kpi rotulo="Conversões" valor={conversoes.length} />
        <Kpi rotulo="Vendas" valor={vendas} formato={(v) => brl(v)} />
        <Kpi rotulo="Comissão" valor={comissao} formato={(v) => brl(v)} />
      </div>
      <Table>
        <THead>
          <Tr>
            <Th>Dia</Th>
            <Th>Oferta</Th>
            <Th>Grupo</Th>
            <Th>Status</Th>
            <Th className="text-right">Valor</Th>
            <Th className="text-right">Comissão</Th>
          </Tr>
        </THead>
        <TBody>
          {conversoes.map((c) => (
            <Tr key={c.id}>
              <Td className="text-xs">{c.dia ?? "—"}</Td>
              <Td className="max-w-64 truncate">
                {c.ofertaId ? (
                  <Link href={`/ofertas/${c.ofertaId}`} className="hover:underline">
                    {c.produto}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">sem link (pedido {c.pedido})</span>
                )}
              </Td>
              <Td>{c.grupo ?? "—"}</Td>
              <Td className="text-xs">{c.status ?? "—"}</Td>
              <Td className="text-right tabular-nums">{brl(c.valor)}</Td>
              <Td className="text-right tabular-nums">{brl(c.comissao)}</Td>
            </Tr>
          ))}
          {conversoes.length === 0 ? (
            <Tr>
              <Td colSpan={6} className="text-muted-foreground">
                Nenhuma conversão no período.
              </Td>
            </Tr>
          ) : null}
        </TBody>
      </Table>
    </div>
  );
}
