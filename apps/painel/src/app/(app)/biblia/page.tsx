import { DOCS_BIBLIA, type ResumoDocBiblia } from "@achadinhos/shared";
import Link from "next/link";
import { IconeDocumento } from "@/components/icones";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { dataHora } from "@/lib/utils";
import { worker } from "@/lib/worker";
import { AbasBiblia } from "./abas";

export const dynamic = "force-dynamic";

export default async function PaginaBiblia() {
  const [{ documentos }, { propostas }] = await Promise.all([
    worker.listarBiblia(),
    worker.listarPropostas("aberta").catch(() => ({ propostas: [] })),
  ]);
  const porSlug = new Map(documentos.map((d) => [d.slug, d]));
  // Os 11 do pacote primeiro, na ordem do pacote; depois qualquer outro que o Coordenador criar.
  const extras = documentos.filter((d) => !(DOCS_BIBLIA as readonly string[]).includes(d.slug));
  const linhas: { slug: string; doc: ResumoDocBiblia | undefined }[] = [
    ...DOCS_BIBLIA.map((slug) => ({ slug, doc: porSlug.get(slug) })),
    ...extras.map((d) => ({ slug: d.slug, doc: d })),
  ];
  const escritos = linhas.filter((l) => l.doc).length;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold">Bíblia</h1>
        <p className="text-sm text-muted-foreground">
          {escritos} de {DOCS_BIBLIA.length} documentos escritos. Quem escreve é o Coordenador, no OpenBot.
        </p>
      </div>

      <AbasBiblia ativo="docs" abertas={propostas.length} />

      {escritos === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">
          Nenhum documento ainda. Eles aparecem aqui quando o Coordenador gravar a bíblia no worker.
        </Card>
      ) : null}

      <ul className="flex flex-col gap-2">
        {linhas.map(({ slug, doc }) => (
          <li key={slug}>
            {doc ? (
              <Link
                href={`/biblia/${slug}`}
                className="block rounded-xl border bg-card p-4 transition-colors hover:bg-accent"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <IconeDocumento className="mt-0.5 size-4 shrink-0 text-primary" />
                    <div className="min-w-0">
                      <p className="truncate font-medium">{doc.titulo}</p>
                      <p className="text-xs text-muted-foreground">
                        {slug}.md · {doc.autor} · {dataHora(doc.criadoEm)}
                      </p>
                    </div>
                  </div>
                  <Badge variant="secondary">v{doc.versao}</Badge>
                </div>
              </Link>
            ) : (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-dashed p-4 text-muted-foreground">
                <span className="text-sm">{slug}.md</span>
                <Badge variant="aviso">ainda não escrito</Badge>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
