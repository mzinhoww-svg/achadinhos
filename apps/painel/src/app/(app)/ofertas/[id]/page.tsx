/* biome-ignore-all lint/performance/noImgElement: peças e fotos vêm de fora e são mostradas como estão. */
import Link from "next/link";
import { notFound } from "next/navigation";
import { Cabecalho } from "@/components/cabecalho";
import { IconeVoltar } from "@/components/icones";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { brl, hora } from "@/lib/tipos";
import { ErroWorker, worker } from "@/lib/worker";
import { checarOferta, prepararOferta } from "../../acoes";
import { STATUS_OFERTA } from "../page";

export const dynamic = "force-dynamic";

interface Detalhe {
  oferta: {
    id: number;
    status: string;
    preco: string;
    medianaPreco30d: string | null;
    descontoPct: string | null;
    pontuacao: string | null;
    motivoReprovacao: string | null;
    ensaio: boolean;
    criadoEm: string;
  };
  produto: {
    id: number;
    nome: string;
    url: string;
    fotoUrl: string | null;
    avaliacao: string | null;
    vendas: number | null;
    lojaNome: string | null;
  };
  nicho: string | null;
  historico: { observacoes: { preco: number; coletadoEm: string }[]; mediana: number | null };
  imagens: {
    id: number;
    formato: string;
    url: string | null;
    fallback: boolean;
    confianca: string | null;
    criadoEm: string;
  }[];
  copies: {
    id: number;
    texto: string;
    validada: boolean;
    escolhida: boolean;
    motivoInvalida: string | null;
    modelo: string | null;
  }[];
  checagens: {
    id: number;
    aprovada: boolean;
    motivos: { codigo: string; detalhe: string }[];
    agente: string;
    criadoEm: string;
  }[];
  envios: {
    envio: {
      id: number;
      status: string;
      agendadoPara: string | null;
      enviadoEm: string | null;
      erro: string | null;
      numeroGateway: string | null;
    };
    grupo: string;
  }[];
}

/** Curva de preço em SVG (sem biblioteca): pontos do histórico e a linha da mediana. */
function Curva({
  pontos,
  mediana,
  preco,
}: {
  pontos: { preco: number; coletadoEm: string }[];
  mediana: number | null;
  preco: number;
}) {
  if (pontos.length < 2)
    return <p className="text-sm text-muted-foreground">Histórico curto demais para a curva.</p>;
  const w = 600;
  const h = 160;
  const valores = [...pontos.map((p) => p.preco), preco, ...(mediana ? [mediana] : [])];
  const min = Math.min(...valores) * 0.95;
  const max = Math.max(...valores) * 1.05;
  const t0 = Date.parse(pontos[0]?.coletadoEm ?? "");
  const t1 = Date.parse(pontos.at(-1)?.coletadoEm ?? "");
  const x = (iso: string) => ((Date.parse(iso) - t0) / Math.max(1, t1 - t0)) * (w - 20) + 10;
  const y = (v: number) => h - 10 - ((v - min) / Math.max(0.01, max - min)) * (h - 20);
  const linha = pontos
    .map((p, i) => `${i ? "L" : "M"}${x(p.coletadoEm).toFixed(1)},${y(p.preco).toFixed(1)}`)
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="h-40 w-full"
      role="img"
      aria-label="Curva de preço dos últimos 30 dias"
    >
      {mediana ? (
        <line
          x1="10"
          x2={w - 10}
          y1={y(mediana)}
          y2={y(mediana)}
          className="stroke-muted-foreground"
          strokeDasharray="4 4"
        />
      ) : null}
      <path d={linha} fill="none" className="stroke-primary" strokeWidth="2" />
      {pontos.map((p) => (
        <circle key={p.coletadoEm} cx={x(p.coletadoEm)} cy={y(p.preco)} r="2.5" className="fill-primary" />
      ))}
    </svg>
  );
}

export default async function Oferta({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const d = await worker.get<Detalhe>(`/ofertas/${id}`).catch((e) => {
    if (e instanceof ErroWorker && e.status === 404) notFound();
    throw e;
  });
  const s = STATUS_OFERTA[d.oferta.status] ?? { rotulo: d.oferta.status, variante: "outline" as const };
  const preco = Number(d.oferta.preco);
  return (
    <div className="flex flex-col gap-5">
      <Link
        href="/ofertas"
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <IconeVoltar className="size-4" /> Ofertas
      </Link>
      <Cabecalho
        titulo={d.produto.nome}
        descricao={`${d.nicho ?? "sem nicho"}${d.produto.lojaNome ? ` · ${d.produto.lojaNome}` : ""}${d.oferta.ensaio ? " · ENSAIO" : ""}`}
        acao={
          <div className="flex gap-2">
            <form action={prepararOferta}>
              <input type="hidden" name="id" value={d.oferta.id} />
              <Button type="submit" variant="outline" size="sm">
                Preparar de novo
              </Button>
            </form>
            <form action={checarOferta}>
              <input type="hidden" name="id" value={d.oferta.id} />
              <Button type="submit" size="sm">
                Checar
              </Button>
            </form>
          </div>
        }
      />
      <Card className="flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant={s.variante}>{s.rotulo}</Badge>
          <span className="font-semibold">{brl(preco)}</span>
          {d.oferta.medianaPreco30d ? (
            <span className="text-muted-foreground">mediana 30 dias {brl(d.oferta.medianaPreco30d)}</span>
          ) : null}
          {d.oferta.descontoPct ? (
            <span className="text-primary">−{Math.round(Number(d.oferta.descontoPct))}%</span>
          ) : null}
          {d.oferta.motivoReprovacao ? (
            <span className="text-muted-foreground">· {d.oferta.motivoReprovacao}</span>
          ) : null}
          <a
            href={d.produto.url}
            target="_blank"
            rel="noreferrer"
            className="ml-auto text-primary hover:underline"
          >
            ver na loja
          </a>
        </div>
        <Curva pontos={d.historico.observacoes} mediana={d.historico.mediana} preco={preco} />
      </Card>

      <section className="grid gap-3 sm:grid-cols-2">
        <Card className="flex flex-col gap-3 p-5">
          <h2 className="text-sm font-medium">Peças</h2>
          {d.imagens.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ainda sem peça.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {d.imagens.slice(0, 2).map((i) => (
                <figure key={i.id} className="flex flex-col gap-1">
                  {i.url ? (
                    <img src={i.url} alt={`Peça ${i.formato}`} className="rounded-md border" loading="lazy" />
                  ) : null}
                  <figcaption className="text-xs text-muted-foreground">
                    {i.formato}
                    {i.fallback ? " · fallback" : ""} · confiança {Number(i.confianca ?? 0).toFixed(2)}
                  </figcaption>
                </figure>
              ))}
            </div>
          )}
        </Card>
        <Card className="flex flex-col gap-3 p-5">
          <h2 className="text-sm font-medium">Copies</h2>
          {d.copies.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ainda sem copy.</p>
          ) : (
            d.copies.slice(0, 4).map((c) => (
              <div key={c.id} className="flex flex-col gap-1 rounded-md border p-3 text-sm">
                <div className="flex gap-1.5">
                  {c.escolhida ? <Badge>escolhida</Badge> : null}
                  <Badge variant={c.validada ? "secondary" : "aviso"}>
                    {c.validada ? "válida" : "reprovada"}
                  </Badge>
                  {c.modelo ? <Badge variant="outline">{c.modelo}</Badge> : null}
                </div>
                <pre className="whitespace-pre-wrap font-sans">{c.texto}</pre>
                {c.motivoInvalida ? (
                  <p className="text-xs text-muted-foreground">{c.motivoInvalida}</p>
                ) : null}
              </div>
            ))
          )}
        </Card>
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <Card className="flex flex-col gap-2 p-5">
          <h2 className="text-sm font-medium">Checagens</h2>
          {d.checagens.map((c) => (
            <div key={c.id} className="text-sm">
              <Badge variant={c.aprovada ? "secondary" : "aviso"}>
                {c.aprovada ? "aprovada" : "reprovada"}
              </Badge>{" "}
              <span className="text-xs text-muted-foreground">
                {c.agente} · {hora(c.criadoEm)}
              </span>
              {c.motivos.map((m) => (
                <p key={m.codigo} className="text-xs text-muted-foreground">
                  {m.codigo}: {m.detalhe}
                </p>
              ))}
            </div>
          ))}
          {d.checagens.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ainda não checada.</p>
          ) : null}
        </Card>
        <Card className="flex flex-col gap-2 p-5">
          <h2 className="text-sm font-medium">Envios</h2>
          {d.envios.map(({ envio, grupo }) => (
            <p key={envio.id} className="text-sm">
              <Badge
                variant={
                  envio.status === "enviado" ? "default" : envio.status === "agendado" ? "secondary" : "aviso"
                }
              >
                {envio.status}
              </Badge>{" "}
              {grupo} · {hora(envio.enviadoEm ?? envio.agendadoPara)}
              {envio.numeroGateway ? ` · ${envio.numeroGateway}` : ""}
              {envio.erro ? <span className="block text-xs text-muted-foreground">{envio.erro}</span> : null}
            </p>
          ))}
          {d.envios.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum envio.</p> : null}
        </Card>
      </section>
    </div>
  );
}
