import { Abas } from "@/components/abas";
import { Cabecalho } from "@/components/cabecalho";
import { Periodo } from "@/components/periodo";
import { Card } from "@/components/ui/card";
import { Table, TBody, Td, THead, Th, Tr } from "@/components/ui/table";
import { brl, type LinhaMetrica, usd } from "@/lib/tipos";
import { worker } from "@/lib/worker";

export const dynamic = "force-dynamic";

type Recorte = "nicho" | "grupo" | "horario" | "oferta";
const RECORTES: { valor: Recorte; rotulo: string }[] = [
  { valor: "nicho", rotulo: "Nicho" },
  { valor: "grupo", rotulo: "Grupo" },
  { valor: "horario", rotulo: "Horário" },
  { valor: "oferta", rotulo: "Oferta" },
];
const DIAS: Record<string, number> = { hoje: 1, "7d": 7, "30d": 30 };

export default async function Numeros({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const f = await searchParams;
  const recorte = RECORTES.find((r) => r.valor === f.recorte)?.valor ?? "nicho";
  const periodo = f.periodo && DIAS[f.periodo] ? f.periodo : "7d";
  const custos = await worker.get<{
    agentes: { agente: string; chamadas: number; custoUsd: number; falhas: number }[];
    totalUsd: number;
    enviadas: number;
    custoPorOfertaEnviadaUsd: number | null;
  }>(`/custos?dias=${DIAS[periodo]}`);
  const { linhas } = await worker.get<{ linhas: LinhaMetrica[] }>(
    `/metricas?recorte=${recorte}&dias=${DIAS[periodo]}`,
  );
  const tot = linhas.reduce(
    (a, l) => ({
      enviadas: a.enviadas + l.enviadas,
      cliques: a.cliques + l.cliques,
      conversoes: a.conversoes + l.conversoes,
      comissao: a.comissao + l.comissao,
    }),
    { enviadas: 0, cliques: 0, conversoes: 0, comissao: 0 },
  );
  return (
    <div className="flex flex-col gap-5">
      <Cabecalho
        titulo="Números"
        descricao="O que dá resultado e o que só gasta, por nicho, grupo, horário e oferta."
      />
      <div className="flex flex-wrap items-center gap-3">
        <Periodo base="/numeros" atual={periodo} extra={{ recorte }} />
        <Abas
          ativo={recorte}
          itens={RECORTES.map((r) => ({ ...r, href: `/numeros?recorte=${r.valor}&periodo=${periodo}` }))}
        />
      </div>
      {linhas.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">Nenhum envio no período.</Card>
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>{RECORTES.find((r) => r.valor === recorte)?.rotulo}</Th>
              <Th className="text-right">Enviadas</Th>
              <Th className="text-right">Cliques</Th>
              <Th className="text-right">Cliques/envio</Th>
              <Th className="text-right">Conversões</Th>
              <Th className="text-right">Comissão</Th>
              <Th className="text-right">Custo IA</Th>
            </Tr>
          </THead>
          <TBody>
            {linhas.map((l) => (
              <Tr key={l.chave}>
                <Td className="min-w-40">{l.chave}</Td>
                <Td className="text-right tabular-nums">{l.enviadas}</Td>
                <Td className="text-right tabular-nums">{l.cliques}</Td>
                <Td className="text-right tabular-nums">
                  {l.enviadas ? (l.cliques / l.enviadas).toFixed(1) : "—"}
                </Td>
                <Td className="text-right tabular-nums">{l.conversoes}</Td>
                <Td className="text-right tabular-nums">{brl(l.comissao)}</Td>
                <Td className="text-right tabular-nums">
                  {l.custoLlmUsd == null ? "—" : usd(l.custoLlmUsd)}
                </Td>
              </Tr>
            ))}
            <Tr className="font-medium">
              <Td>Total</Td>
              <Td className="text-right tabular-nums">{tot.enviadas}</Td>
              <Td className="text-right tabular-nums">{tot.cliques}</Td>
              <Td className="text-right tabular-nums">
                {tot.enviadas ? (tot.cliques / tot.enviadas).toFixed(1) : "—"}
              </Td>
              <Td className="text-right tabular-nums">{tot.conversoes}</Td>
              <Td className="text-right tabular-nums">{brl(tot.comissao)}</Td>
              <Td />
            </Tr>
          </TBody>
        </Table>
      )}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Custo de IA por agente</h2>
        <Table>
          <THead>
            <Tr>
              <Th>Agente</Th>
              <Th className="text-right">Chamadas</Th>
              <Th className="text-right">Falhas</Th>
              <Th className="text-right">Custo</Th>
            </Tr>
          </THead>
          <TBody>
            {custos.agentes.map((a) => (
              <Tr key={a.agente}>
                <Td>{a.agente}</Td>
                <Td className="text-right tabular-nums">{a.chamadas}</Td>
                <Td className="text-right tabular-nums">{a.falhas}</Td>
                <Td className="text-right tabular-nums">{usd(a.custoUsd)}</Td>
              </Tr>
            ))}
            {custos.agentes.length === 0 ? (
              <Tr>
                <Td colSpan={4} className="text-muted-foreground">
                  Nenhuma chamada paga no período.
                </Td>
              </Tr>
            ) : null}
            <Tr className="font-medium">
              <Td>Total</Td>
              <Td />
              <Td />
              <Td className="text-right tabular-nums">{usd(custos.totalUsd)}</Td>
            </Tr>
          </TBody>
        </Table>
        <p className="text-xs text-muted-foreground">
          Custo de IA por oferta enviada:{" "}
          {custos.custoPorOfertaEnviadaUsd == null ? "—" : usd(custos.custoPorOfertaEnviadaUsd)} (
          {custos.enviadas} enviadas no período). Os agentes do OpenBot registram o próprio gasto com a
          ferramenta registrar_custo.
        </p>
      </section>
    </div>
  );
}
