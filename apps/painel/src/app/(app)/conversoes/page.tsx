import { Cabecalho } from "@/components/cabecalho";
import { FaixaDemo } from "@/components/faixa-demo";
import { Filtros } from "@/components/filtros";
import { Periodo } from "@/components/periodo";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, Td, THead, Th, Tr } from "@/components/ui/table";
import { brl, CONVERSOES, GRUPOS } from "@/lib/demo";

export default async function Conversoes({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const f = await searchParams;
  const lista = CONVERSOES.filter(
    (c) => (!f.grupo || c.grupo === f.grupo) && (!f.status || c.status === f.status),
  );
  const total = lista.reduce((s, c) => s + c.comissao, 0);
  return (
    <div className="flex flex-col gap-5">
      <Cabecalho
        titulo="Conversões"
        descricao={`Pedidos ligados a oferta, grupo e horário pelos subIds. Comissão no filtro: ${brl(total)}.`}
      />
      <FaixaDemo motivo="As conversões reais vêm do relatório da Shopee Afiliados (tabela conversoes)." />
      <div className="flex flex-wrap items-end gap-3">
        <Periodo base="/conversoes" atual={f.periodo ?? "7d"} extra={{ grupo: f.grupo, status: f.status }} />
        <Filtros
          valores={f}
          campos={[
            {
              nome: "grupo",
              rotulo: "Grupo",
              opcoes: GRUPOS.map((g) => ({ valor: g.nome, rotulo: g.nome })),
            },
            {
              nome: "status",
              rotulo: "Status",
              opcoes: ["pendente", "aprovada", "cancelada"].map((s) => ({ valor: s, rotulo: s })),
            },
          ]}
        />
      </div>
      <Table>
        <THead>
          <Tr>
            <Th>Pedido</Th>
            <Th>Oferta</Th>
            <Th>Grupo · hora</Th>
            <Th className="text-right">Valor</Th>
            <Th className="text-right">Comissão</Th>
            <Th>Status</Th>
          </Tr>
        </THead>
        <TBody>
          {lista.map((c) => (
            <Tr key={c.pedido}>
              <Td className="whitespace-nowrap font-mono text-xs">{c.pedido}</Td>
              <Td className="min-w-48">{c.oferta}</Td>
              <Td className="whitespace-nowrap">
                {c.grupo} · {c.horario}
              </Td>
              <Td className="text-right tabular-nums">{brl(c.valor)}</Td>
              <Td className="text-right tabular-nums">{brl(c.comissao)}</Td>
              <Td>
                <Badge variant={c.status === "aprovada" ? "default" : "outline"}>{c.status}</Badge>
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </div>
  );
}
