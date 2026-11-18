import Link from "next/link";
import { notFound } from "next/navigation";
import { IconeVoltar } from "@/components/icones";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { markdownParaHtml } from "@/lib/markdown";
import { cn, dataHora } from "@/lib/utils";
import { ErroWorker, worker } from "@/lib/worker";

export const dynamic = "force-dynamic";

export default async function PaginaDoc({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ versao?: string }>;
}) {
  const { slug } = await params;
  const { versao: v } = await searchParams;
  const versao = v && /^\d+$/.test(v) ? Number(v) : undefined;
  const [doc, { versoes }] = await Promise.all([
    worker.lerDoc(slug, versao).catch((e) => {
      if (e instanceof ErroWorker && (e.status === 404 || e.status === 400)) return null;
      throw e;
    }),
    worker.versoes(slug).catch(() => ({ versoes: [] })),
  ]);
  if (!doc) notFound();
  const atual = versoes[0]?.versao === doc.versao;

  return (
    <div className="flex flex-col gap-5">
      <Link
        href="/biblia"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <IconeVoltar className="size-4" /> Bíblia
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold">{doc.titulo}</h1>
        <Badge variant={atual ? "secondary" : "aviso"}>
          v{doc.versao}
          {atual ? " · atual" : " · antiga"}
        </Badge>
      </div>
      <p className="-mt-3 text-sm text-muted-foreground">
        {doc.slug}.md · {doc.autor} · {dataHora(doc.criadoEm)}
        {doc.motivo ? ` · ${doc.motivo}` : ""}
      </p>

      <div className="grid gap-5 lg:grid-cols-[1fr_220px]">
        <Card
          className="prose prose-neutral max-w-none p-5 dark:prose-invert prose-headings:font-semibold"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: markdown-it com html:false (src/lib/markdown.ts).
          dangerouslySetInnerHTML={{ __html: markdownParaHtml(doc.conteudo) }}
        />
        <aside className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">Versões</h2>
          <ul className="flex flex-col gap-1">
            {versoes.map((x) => (
              <li key={x.versao}>
                <Link
                  href={`/biblia/${doc.slug}?versao=${x.versao}`}
                  className={cn(
                    "block rounded-md px-3 py-2 text-sm hover:bg-accent",
                    x.versao === doc.versao && "bg-accent font-medium",
                  )}
                >
                  v{x.versao} · {dataHora(x.criadoEm)}
                  <span className="block text-xs text-muted-foreground">{x.autor}</span>
                </Link>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}
