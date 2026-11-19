/* biome-ignore-all lint/performance/noImgElement: fotos vêm da Shopee e são mostradas como estão. */
import Link from "next/link";
import { Cabecalho } from "@/components/cabecalho";
import { Filtros } from "@/components/filtros";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { brl, hora, type Nicho, type OfertaLista } from "@/lib/tipos";
import { worker } from "@/lib/worker";

export const dynamic = "force-dynamic";

export const STATUS_OFERTA: Record<
  string,
  { rotulo: string; variante: "default" | "secondary" | "outline" | "aviso" }
> = {
  candidata: { rotulo: "candidata", variante: "outline" },
  aprovada: { rotulo: "aprovada", variante: "secondary" },
  agendada: { rotulo: "agendada", variante: "secondary" },
  enviada: { rotulo: "enviada", variante: "default" },
  reprovada: { rotulo: "reprovada", variante: "aviso" },
  cancelada: { rotulo: "cancelada", variante: "aviso" },
  expirada: { rotulo: "expirada", variante: "outline" },
};

export default async function Ofertas({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const f = await searchParams;
  const q = new URLSearchParams({ limite: "100" });
  if (f.status) q.set("status", f.status);
  if (f.nicho) q.set("nichoId", f.nicho);
  const [{ ofertas }, { nichos }] = await Promise.all([
    worker.get<{ ofertas: OfertaLista[] }>(`/ofertas?${q}`),
    worker.get<{ nichos: Nicho[] }>("/nichos"),
  ]);
  return (
    <div className="flex flex-col gap-5">
      <Cabecalho titulo="Ofertas" descricao="Todas as ofertas detectadas, as de maior pontuação primeiro." />
      <Filtros
        valores={f}
        campos={[
          {
            nome: "status",
            rotulo: "Status",
            opcoes: Object.keys(STATUS_OFERTA).map((s) => ({ valor: s, rotulo: s })),
          },
          {
            nome: "nicho",
            rotulo: "Nicho",
            opcoes: nichos.map((n) => ({ valor: String(n.id), rotulo: n.nome })),
          },
        ]}
      />
      {ofertas.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">
          Nenhuma oferta com esses filtros. As primeiras ofertas reais aparecem depois de 3 dias de histórico
          de preço.
        </Card>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {ofertas.map((o) => {
            const s = STATUS_OFERTA[o.status] ?? { rotulo: o.status, variante: "outline" as const };
            return (
              <li key={o.id}>
                <Link href={`/ofertas/${o.id}`} className="block">
                  <Card className="flex gap-3 p-3 transition-colors hover:bg-accent/40">
                    {o.produto.fotoUrl ? (
                      <img
                        src={o.produto.fotoUrl}
                        alt=""
                        className="size-20 shrink-0 rounded-md border object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="size-20 shrink-0 rounded-md border bg-muted" />
                    )}
                    <div className="flex min-w-0 flex-col gap-1">
                      <p className="line-clamp-2 text-sm font-medium">{o.produto.nome}</p>
                      <p className="text-sm">
                        <span className="font-semibold">{brl(o.preco)}</span>
                        {o.mediana30d ? (
                          <span className="text-muted-foreground"> · mediana {brl(o.mediana30d)}</span>
                        ) : null}
                        {o.descontoPct ? (
                          <span className="text-primary"> · −{Math.round(o.descontoPct)}%</span>
                        ) : null}
                      </p>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <Badge variant={s.variante}>{s.rotulo}</Badge>
                        {o.pontuacao != null ? <span>pontuação {o.pontuacao.toFixed(0)}</span> : null}
                        <span>{hora(o.criadoEm)}</span>
                      </div>
                    </div>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
