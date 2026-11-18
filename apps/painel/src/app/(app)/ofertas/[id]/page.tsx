import Link from "next/link";
import { notFound } from "next/navigation";
import { FaixaDemo } from "@/components/faixa-demo";
import { IconeVoltar } from "@/components/icones";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { brl, desconto, OFERTAS } from "@/lib/demo";

export default async function PecaCompleta({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const o = OFERTAS.find((x) => String(x.id) === id);
  if (!o) notFound();
  return (
    <div className="flex flex-col gap-5">
      <Link
        href="/ofertas"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <IconeVoltar className="size-4" /> Ofertas
      </Link>
      <FaixaDemo motivo="A peça real vem de /imagem/render e /ofertas/:id/copy." />
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold">{o.nome}</h1>
        <Badge variant={o.status === "reprovada" ? "aviso" : "secondary"}>{o.status}</Badge>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="flex flex-col items-center gap-3 p-5">
          {/* biome-ignore lint/performance/noImgElement: imagem de demonstração em data URI. */}
          <img
            src={o.foto}
            alt={`Peça visual de ${o.nome}`}
            className="aspect-square w-full max-w-xs rounded-xl"
          />
          <p className="text-xs text-muted-foreground">
            Foto real do produto no template visual. A IA nunca altera o produto.
          </p>
        </Card>
        <div className="flex flex-col gap-4">
          <Card className="p-4">
            <h2 className="mb-2 text-sm font-medium">Mensagem</h2>
            <p className="whitespace-pre-wrap text-sm">
              {o.copy || "Sem mensagem: a oferta não chegou à etapa do Copywriter."}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">Link curto: {o.link}</p>
          </Card>
          <Card className="grid grid-cols-3 gap-2 p-4 text-center">
            <div>
              <p className="text-xs text-muted-foreground">Preço</p>
              <p className="font-semibold">{brl(o.preco)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Mediana 30 dias</p>
              <p className="font-semibold">{brl(o.mediana30d)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Desconto real</p>
              <p className="font-semibold">−{desconto(o)}%</p>
            </div>
          </Card>
          <Card className="p-4 text-sm">
            <p>
              <span className="text-muted-foreground">Nicho:</span> {o.nicho}
            </p>
            <p>
              <span className="text-muted-foreground">Grupo:</span> {o.grupo} · {o.horario}
            </p>
            <p>
              <span className="text-muted-foreground">Último agente:</span> {o.agente}
            </p>
            {o.motivo ? (
              <p className="mt-2 text-destructive">
                <span className="font-medium">Reprovada:</span> {o.motivo}
              </p>
            ) : null}
          </Card>
        </div>
      </div>
    </div>
  );
}
