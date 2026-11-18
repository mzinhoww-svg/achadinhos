import { Cabecalho } from "@/components/cabecalho";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { dataHora } from "@/lib/utils";
import { worker } from "@/lib/worker";
import { AbasBiblia } from "../abas";
import { decidir } from "./acoes";

export const dynamic = "force-dynamic";

export default async function Propostas() {
  const { propostas } = await worker.listarPropostas();
  const abertas = propostas.filter((p) => p.status === "aberta");
  const decididas = propostas.filter((p) => p.status !== "aberta").slice(0, 20);
  return (
    <div className="flex flex-col gap-5">
      <Cabecalho
        titulo="Bíblia"
        descricao="Mudanças propostas pelos agentes. Só o Coordenador ou você aprova."
      />
      <AbasBiblia ativo="propostas" abertas={abertas.length} />
      {abertas.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">Nenhuma proposta aberta.</Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {abertas.map((p) => (
            <li key={p.id}>
              <Card className="flex flex-col gap-3 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">
                    #{p.id} · {p.titulo}
                  </p>
                  {p.docSlug ? <Badge variant="outline">{p.docSlug}.md</Badge> : null}
                </div>
                <p className="text-sm">{p.descricao}</p>
                <p className="text-xs text-muted-foreground">
                  {p.autor} · {dataHora(p.criadoEm)}
                </p>
                {p.conteudoProposto ? (
                  <details className="rounded-md border bg-muted/40 p-3 text-sm">
                    <summary className="cursor-pointer font-medium">Texto proposto</summary>
                    <pre className="mt-2 whitespace-pre-wrap font-sans">{p.conteudoProposto}</pre>
                  </details>
                ) : null}
                <form action={decidir} className="flex gap-2">
                  <input type="hidden" name="id" value={p.id} />
                  <Button type="submit" name="decisao" value="aprovada">
                    Aprovar
                  </Button>
                  <Button type="submit" name="decisao" value="rejeitada" variant="outline">
                    Recusar
                  </Button>
                </form>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {decididas.length ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">Decididas</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {decididas.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 rounded-md px-2 py-1.5">
                <Badge variant={p.status === "aprovada" ? "secondary" : "outline"}>{p.status}</Badge>#{p.id} ·{" "}
                {p.titulo}
                <span className="text-xs text-muted-foreground">por {p.decididoPor}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
