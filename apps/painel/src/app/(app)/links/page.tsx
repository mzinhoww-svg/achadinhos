import { Cabecalho } from "@/components/cabecalho";
import { FaixaDemo } from "@/components/faixa-demo";
import { Filtros } from "@/components/filtros";
import { Periodo } from "@/components/periodo";
import { Table, TBody, Td, THead, Th, Tr } from "@/components/ui/table";
import { GRUPOS, LINKS } from "@/lib/demo";

export default async function Links({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const f = await searchParams;
  const lista = LINKS.filter((l) => !f.grupo || l.grupo === f.grupo).sort((a, b) => b.cliques - a.cliques);
  return (
    <div className="flex flex-col gap-5">
      <Cabecalho
        titulo="Links e cliques"
        descricao="Cada link curto leva subIds de grupo, nicho, oferta e horário."
      />
      <FaixaDemo motivo="Os links reais saem das tabelas links e cliques." />
      <div className="flex flex-wrap items-end gap-3">
        <Periodo base="/links" atual={f.periodo ?? "7d"} extra={{ grupo: f.grupo }} />
        <Filtros
          valores={f}
          campos={[
            {
              nome: "grupo",
              rotulo: "Grupo",
              opcoes: GRUPOS.map((g) => ({ valor: g.nome, rotulo: g.nome })),
            },
          ]}
        />
      </div>
      <Table>
        <THead>
          <Tr>
            <Th>Link</Th>
            <Th>Oferta</Th>
            <Th>Grupo</Th>
            <Th>subIds</Th>
            <Th className="text-right">Cliques</Th>
          </Tr>
        </THead>
        <TBody>
          {lista.map((l) => (
            <Tr key={l.curto}>
              <Td className="whitespace-nowrap font-mono text-xs">{l.curto}</Td>
              <Td className="min-w-48">{l.oferta}</Td>
              <Td className="whitespace-nowrap">{l.grupo}</Td>
              <Td className="whitespace-nowrap font-mono text-xs text-muted-foreground">{l.subIds}</Td>
              <Td className="text-right tabular-nums">{l.cliques}</Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </div>
  );
}
