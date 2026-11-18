import Link from "next/link";
import { Cabecalho } from "@/components/cabecalho";
import { FaixaDemo } from "@/components/faixa-demo";
import { Filtros } from "@/components/filtros";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { brl, desconto, GRUPOS, NICHOS, OFERTAS, type StatusOferta } from "@/lib/demo";

const STATUS: Record<
  StatusOferta,
  { rotulo: string; variante: "default" | "secondary" | "outline" | "aviso" }
> = {
  candidata: { rotulo: "candidata", variante: "outline" },
  aprovada: { rotulo: "aprovada", variante: "secondary" },
  agendada: { rotulo: "agendada", variante: "secondary" },
  enviada: { rotulo: "enviada", variante: "default" },
  reprovada: { rotulo: "reprovada", variante: "aviso" },
};

export default async function Ofertas({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const f = await searchParams;
  const lista = OFERTAS.filter(
    (o) =>
      (!f.status || o.status === f.status) &&
      (!f.nicho || o.nicho === f.nicho) &&
      (!f.grupo || o.grupo === f.grupo),
  );
  return (
    <div className="flex flex-col gap-5">
      <Cabecalho
        titulo="Ofertas"
        descricao="Tudo o que os agentes encontraram hoje. A checagem automática decide o que sai."
      />
      <FaixaDemo motivo="As ofertas reais chegam com as ferramentas /coleta/buscar e /ofertas do worker." />
      <Filtros
        valores={f}
        campos={[
          {
            nome: "status",
            rotulo: "Status",
            opcoes: Object.keys(STATUS).map((s) => ({ valor: s, rotulo: s })),
          },
          { nome: "nicho", rotulo: "Nicho", opcoes: NICHOS.map((n) => ({ valor: n.nome, rotulo: n.nome })) },
          { nome: "grupo", rotulo: "Grupo", opcoes: GRUPOS.map((g) => ({ valor: g.nome, rotulo: g.nome })) },
        ]}
      />
      {lista.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">Nenhuma oferta com esses filtros.</Card>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {lista.map((o) => (
            <li key={o.id}>
              <Link
                href={`/ofertas/${o.id}`}
                className="flex gap-3 rounded-xl border bg-card p-3 transition-colors hover:bg-accent"
              >
                {/* biome-ignore lint/performance/noImgElement: imagem de demonstração em data URI. */}
                <img src={o.foto} alt="" className="size-16 shrink-0 rounded-lg" />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <p className="truncate font-medium">{o.nome}</p>
                  <p className="text-sm">
                    <span className="font-semibold">{brl(o.preco)}</span>{" "}
                    <span className="text-muted-foreground">
                      mediana {brl(o.mediana30d)} · −{desconto(o)}%
                    </span>
                  </p>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant={STATUS[o.status].variante}>{STATUS[o.status].rotulo}</Badge>
                    {o.horario} · {o.grupo}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
