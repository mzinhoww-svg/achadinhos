/* biome-ignore-all lint/performance/noImgElement: capas vêm do worker e são mostradas como estão. */
import { Cabecalho } from "@/components/cabecalho";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { hora } from "@/lib/tipos";
import { worker } from "@/lib/worker";

export const dynamic = "force-dynamic";

interface ReelLinha {
  reel: {
    id: number;
    palavra: string;
    modelo: string;
    status: string;
    fonte: string | null;
    reelUrl: string | null;
    capaUrl: string | null;
    legenda: string | null;
    dmTexto: string | null;
    agendadoPara: string | null;
    erro: string | null;
  };
  produto: { id: number; nome: string; url: string };
}

const COR: Record<string, "default" | "secondary" | "outline" | "aviso"> = {
  video_pendente: "outline",
  pronto: "secondary",
  agendado: "secondary",
  publicado: "default",
  falhou: "aviso",
};

export default async function Reels() {
  const { reels } = await worker.get<{ reels: ReelLinha[] }>("/reels?limite=120");
  const porStatus = reels.reduce<Record<string, number>>(
    (a, r) => ({ ...a, [r.reel.status]: (a[r.reel.status] ?? 0) + 1 }),
    {},
  );
  const porFonte = reels.reduce<Record<string, number>>(
    (a, r) => (r.reel.fonte ? { ...a, [r.reel.fonte]: (a[r.reel.fonte] ?? 0) + 1 } : a),
    {},
  );
  return (
    <div className="flex flex-col gap-5">
      <Cabecalho
        titulo="Reels"
        descricao="A vitrine no Instagram: cada Reel pede um comentário com a palavra, e a DM leva o link e o grupo."
      />
      <Card className="flex flex-wrap gap-3 p-4 text-sm">
        {Object.entries(porStatus).map(([s, n]) => (
          <Badge key={s} variant={COR[s] ?? "outline"}>
            {s.replace("_", " ")}: {n}
          </Badge>
        ))}
        <span className="text-muted-foreground">
          vídeo da Shopee: {porFonte.video ?? 0} · das fotos: {porFonte.fotos ?? 0}
        </span>
      </Card>
      {reels.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">
          Nenhum Reel planejado. O Diretor de Vídeo planeja os 40 do dia às 06:45.
        </Card>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {reels.map(({ reel, produto }) => (
            <li key={reel.id}>
              <Card className="flex gap-3 p-3">
                {reel.capaUrl ? (
                  <a href={reel.reelUrl ?? undefined} target="_blank" rel="noreferrer" className="shrink-0">
                    <img
                      src={reel.capaUrl}
                      alt=""
                      className="h-36 w-20 rounded-md border object-cover"
                      loading="lazy"
                    />
                  </a>
                ) : (
                  <div className="h-36 w-20 shrink-0 rounded-md border bg-muted" />
                )}
                <div className="flex min-w-0 flex-col gap-1 text-sm">
                  <p className="line-clamp-2 font-medium">{produto.nome}</p>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge>{reel.palavra}</Badge>
                    <Badge variant={COR[reel.status] ?? "outline"}>{reel.status.replace("_", " ")}</Badge>
                    <Badge variant="outline">{reel.modelo}</Badge>
                    {reel.fonte ? (
                      <Badge variant="outline">{reel.fonte === "video" ? "vídeo Shopee" : "fotos"}</Badge>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground">{hora(reel.agendadoPara)}</p>
                  {reel.erro ? <p className="text-xs text-muted-foreground">{reel.erro}</p> : null}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
