/* biome-ignore-all lint/performance/noImgElement: as peças vêm de fora (Blob da Vertra e Shopee) e são mostradas como estão. */
import { Cabecalho } from "@/components/cabecalho";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { dataHora } from "@/lib/utils";
import { type Renderizacao, worker } from "@/lib/worker";
import { gerarLote } from "./acoes";

export const dynamic = "force-dynamic";

const brl = (v: number | null) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function Imagem({ src, rotulo, proporcao }: { src: string | null; rotulo: string; proporcao: string }) {
  return (
    <figure className="flex min-w-0 flex-col gap-1.5">
      <a
        href={src ?? undefined}
        target="_blank"
        rel="noreferrer"
        className={`block overflow-hidden rounded-md border bg-muted ${proporcao}`}
      >
        {src ? <img src={src} alt={rotulo} loading="lazy" className="h-full w-full object-contain" /> : null}
      </a>
      <figcaption className="text-xs text-muted-foreground">{rotulo}</figcaption>
    </figure>
  );
}

function Linha({ r }: { r: Renderizacao }) {
  const quadrado = r.pecas.find((p) => p.formato === "quadrado");
  const retrato = r.pecas.find((p) => p.formato === "retrato");
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <a
          href={r.produto.url}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 truncate font-medium hover:underline"
        >
          {r.produto.nome}
        </a>
        {r.fallback ? (
          <Badge variant="aviso">Fallback: foto original</Badge>
        ) : (
          <Badge variant="secondary">Recorte ok</Badge>
        )}
        {r.confianca != null ? <Badge variant="outline">confiança {r.confianca.toFixed(2)}</Badge> : null}
        {r.origemPreco === "previa" ? <Badge variant="outline">prévia (desconto da loja)</Badge> : null}
        {r.ampliada ? <Badge variant="outline">ampliada</Badge> : null}
      </div>
      <p className="text-xs text-muted-foreground">
        {brl(r.preco)}
        {r.precoAntigo ? ` · de ${brl(r.precoAntigo)}` : ""}
        {r.descontoPct ? ` · −${Math.round(r.descontoPct)}%` : ""} · template {r.template} ·{" "}
        {dataHora(r.criadoEm)}
        {r.motivoFallback ? ` · ${r.motivoFallback}` : ""}
      </p>
      <div className="grid grid-cols-3 items-start gap-3">
        <Imagem src={r.fotoOriginalUrl} rotulo="Original (Shopee)" proporcao="aspect-square" />
        <Imagem src={quadrado?.url ?? null} rotulo="Quadrado 1080×1080" proporcao="aspect-square" />
        <Imagem src={retrato?.url ?? null} rotulo="Retrato 1080×1350" proporcao="aspect-[4/5]" />
      </div>
    </Card>
  );
}

export default async function Conferencia() {
  const { renderizacoes, armazenamento } = await worker.listarImagens(30);
  const fallbacks = renderizacoes.filter((r) => r.fallback).length;
  return (
    <div className="flex flex-col gap-5">
      <Cabecalho
        titulo="Conferência da arte"
        descricao="Cada peça ao lado da foto original. O produto é sempre a foto real; só o entorno muda."
      />
      <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="text-sm">
          <p>
            {renderizacoes.length} renderizações · {fallbacks} no fallback
          </p>
          <p className="text-xs text-muted-foreground">
            Peças guardadas em: {armazenamento === "vertra-blob" ? "Blob da Vertra" : "banco (reserva)"}
          </p>
        </div>
        <form action={gerarLote} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="limite" value="10" />
          <input type="hidden" name="fallback" value="1" />
          <Button type="submit">Gerar 10 peças (1 com fallback forçado)</Button>
        </form>
      </Card>
      <p className="text-xs text-muted-foreground">
        O lote roda em segundo plano (cerca de 3 s por produto). Atualize a página para ver as novas peças.
      </p>
      {renderizacoes.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">Nenhuma peça renderizada ainda.</Card>
      ) : (
        <div className="flex flex-col gap-3">
          {renderizacoes.map((r) => (
            <Linha key={r.chave} r={r} />
          ))}
        </div>
      )}
    </div>
  );
}
