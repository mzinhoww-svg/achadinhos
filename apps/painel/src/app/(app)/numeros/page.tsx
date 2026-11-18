import { Abas } from "@/components/abas";
import { Cabecalho } from "@/components/cabecalho";
import { FaixaDemo } from "@/components/faixa-demo";
import { Periodo } from "@/components/periodo";
import { Card } from "@/components/ui/card";
import { Table, TBody, Td, THead, Th, Tr } from "@/components/ui/table";
import { brl, METRICAS, type Recorte, usd } from "@/lib/demo";

const RECORTES: { valor: Recorte; rotulo: string }[] = [
  { valor: "nicho", rotulo: "Nicho" },
  { valor: "grupo", rotulo: "Grupo" },
  { valor: "horario", rotulo: "Horário" },
  { valor: "oferta", rotulo: "Oferta" },
];

export default async function Numeros({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const f = await searchParams;
  const recorte = (RECORTES.find((r) => r.valor === f.recorte)?.valor ?? "nicho") as Recorte;
  const periodo = f.periodo ?? "7d";
  const linhas = [...METRICAS[recorte]].sort((a, b) => b.comissao - a.comissao);
  const maxCliques = Math.max(...METRICAS.horario.map((h) => h.cliques));
  return (
    <div className="flex flex-col gap-5">
      <Cabecalho
        titulo="Números"
        descricao="O que dá resultado e o que só gasta, por nicho, grupo, horário e oferta."
      />
      <FaixaDemo motivo="Os números reais saem das tabelas envios, cliques, conversoes e chamadas_pagas." />
      <div className="flex flex-wrap items-center gap-3">
        <Periodo base="/numeros" atual={periodo} extra={{ recorte }} />
        <Abas
          ativo={recorte}
          itens={RECORTES.map((r) => ({ ...r, href: `/numeros?recorte=${r.valor}&periodo=${periodo}` }))}
        />
      </div>
      <Table>
        <THead>
          <Tr>
            <Th>{RECORTES.find((r) => r.valor === recorte)?.rotulo}</Th>
            <Th className="text-right">Enviadas</Th>
            <Th className="text-right">Cliques</Th>
            <Th className="text-right">Conv./clique</Th>
            <Th className="text-right">Conversões</Th>
            <Th className="text-right">Comissão</Th>
            <Th className="text-right">Custo LLM</Th>
          </Tr>
        </THead>
        <TBody>
          {linhas.map((l) => (
            <Tr key={l.chave}>
              <Td className="min-w-40">{l.chave}</Td>
              <Td className="text-right tabular-nums">{l.enviadas}</Td>
              <Td className="text-right tabular-nums">{l.cliques}</Td>
              <Td className="text-right tabular-nums">{((l.conversoes / l.cliques) * 100).toFixed(1)}%</Td>
              <Td className="text-right tabular-nums">{l.conversoes}</Td>
              <Td className="text-right tabular-nums">{brl(l.comissao)}</Td>
              <Td className="text-right tabular-nums">{usd(l.custoLlm)}</Td>
            </Tr>
          ))}
        </TBody>
      </Table>
      {/* Único gráfico: decide os horários de envio. */}
      <Card className="flex flex-col gap-3 p-4">
        <div>
          <h2 className="text-sm font-medium">Cliques por horário de envio</h2>
          <p className="text-xs text-muted-foreground">
            Para decidir quais horários manter na REGRAS-DE-ENVIO.
          </p>
        </div>
        <ul className="flex flex-col gap-2">
          {METRICAS.horario.map((h) => (
            <li key={h.chave} className="grid grid-cols-[3rem_1fr_3rem] items-center gap-2 text-sm">
              <span className="tabular-nums text-muted-foreground">{h.chave}</span>
              <div className="h-3 rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${(h.cliques / maxCliques) * 100}%` }}
                />
              </div>
              <span className="text-right tabular-nums">{h.cliques}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
