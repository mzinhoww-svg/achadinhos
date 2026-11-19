import Link from "next/link";
import { Cabecalho } from "@/components/cabecalho";
import { Periodo } from "@/components/periodo";
import { Card } from "@/components/ui/card";
import { Table, TBody, Td, THead, Th, Tr } from "@/components/ui/table";
import { hora, type LinkCurto } from "@/lib/tipos";
import { worker } from "@/lib/worker";

export const dynamic = "force-dynamic";
const DIAS: Record<string, number> = { hoje: 1, "7d": 7, "30d": 30 };

export default async function Links({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const f = await searchParams;
  const periodo = f.periodo && DIAS[f.periodo] ? f.periodo : "7d";
  const { links, cliquesPorHora } = await worker.get<{
    links: LinkCurto[];
    cliquesPorHora: { hora: string; n: number }[];
  }>(`/links?dias=${DIAS[periodo]}`);
  const max = Math.max(1, ...cliquesPorHora.map((h) => h.n));
  return (
    <div className="flex flex-col gap-5">
      <Cabecalho
        titulo="Links e cliques"
        descricao="Um link curto por oferta e grupo. Cada clique fica registrado (sem guardar o IP)."
      />
      <Periodo base="/links" atual={periodo} />
      <Card className="flex flex-col gap-2 p-5">
        <h2 className="text-sm font-medium">Cliques por horário</h2>
        {cliquesPorHora.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem cliques no período.</p>
        ) : (
          <div className="flex h-28 items-end gap-1" role="img" aria-label="Cliques por hora do dia">
            {Array.from({ length: 24 }, (_, i) => {
              const h = String(i).padStart(2, "0");
              const n = cliquesPorHora.find((x) => x.hora === h)?.n ?? 0;
              return (
                <div key={h} className="flex flex-1 flex-col items-center gap-1" title={`${h}h: ${n}`}>
                  <div className="w-full rounded-t bg-primary/80" style={{ height: `${(n / max) * 90}px` }} />
                  {i % 3 === 0 ? <span className="text-[10px] text-muted-foreground">{h}</span> : null}
                </div>
              );
            })}
          </div>
        )}
      </Card>
      <Table>
        <THead>
          <Tr>
            <Th>Oferta</Th>
            <Th>Grupo</Th>
            <Th>Código</Th>
            <Th className="text-right">Cliques</Th>
            <Th className="text-right">Únicos</Th>
            <Th>Criado</Th>
          </Tr>
        </THead>
        <TBody>
          {links.map((l) => (
            <Tr key={l.id}>
              <Td className="max-w-64 truncate">
                <Link href={`/ofertas/${l.ofertaId}`} className="hover:underline">
                  {l.produto}
                </Link>
              </Td>
              <Td>{l.grupo ?? "—"}</Td>
              <Td className="font-mono text-xs">/r/{l.codigo}</Td>
              <Td className="text-right tabular-nums">{l.cliques}</Td>
              <Td className="text-right tabular-nums">{l.unicos}</Td>
              <Td className="text-xs">{hora(l.criadoEm)}</Td>
            </Tr>
          ))}
          {links.length === 0 ? (
            <Tr>
              <Td colSpan={6} className="text-muted-foreground">
                Nenhum link no período: eles nascem no momento do envio.
              </Td>
            </Tr>
          ) : null}
        </TBody>
      </Table>
    </div>
  );
}
