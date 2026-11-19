import Link from "next/link";
import { Abas } from "@/components/abas";
import { Cabecalho } from "@/components/cabecalho";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { type Checagem, type Envio, hora } from "@/lib/tipos";
import { worker } from "@/lib/worker";
import { criarEnsaio } from "../acoes";

export const dynamic = "force-dynamic";

export default async function Checagens({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { aba = "reprovadas" } = await searchParams;
  const [{ checagens }, { envios }] = await Promise.all([
    worker.get<{ checagens: Checagem[] }>("/checagens?limite=100"),
    worker.get<{ envios: Envio[] }>("/envios?dias=7&limite=100"),
  ]);
  const reprovadas = checagens.filter((c) => !c.aprovada);
  const enviados = envios.filter(
    (e) => e.status === "enviado" || e.status === "agendado" || e.status === "enviando",
  );
  const problemas = envios.filter((e) => e.status === "falhou" || e.status === "cancelado");
  return (
    <div className="flex flex-col gap-5">
      <Cabecalho
        titulo="Checagens"
        descricao="O que saiu, o que está agendado e o que a checagem automática barrou, com o motivo."
        acao={
          <form action={criarEnsaio}>
            <Button type="submit" variant="outline" size="sm">
              Rodar oferta de ensaio
            </Button>
          </form>
        }
      />
      <Abas
        ativo={aba}
        itens={[
          {
            valor: "reprovadas",
            rotulo: `Reprovadas (${reprovadas.length})`,
            href: "/checagens?aba=reprovadas",
          },
          {
            valor: "enviadas",
            rotulo: `Enviadas e agendadas (${enviados.length})`,
            href: "/checagens?aba=enviadas",
          },
          {
            valor: "problemas",
            rotulo: `Canceladas e falhas (${problemas.length})`,
            href: "/checagens?aba=problemas",
          },
        ]}
      />
      {aba === "reprovadas" ? (
        <ul className="flex flex-col gap-2">
          {reprovadas.map((c) => (
            <li key={c.id}>
              <Card className="flex flex-col gap-1 p-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/ofertas/${c.ofertaId}`} className="font-medium hover:underline">
                    {c.produto}
                  </Link>
                  {c.ensaio ? <Badge variant="outline">ensaio</Badge> : null}
                  <span className="ml-auto text-xs text-muted-foreground">{hora(c.criadoEm)}</span>
                </div>
                {c.motivos.map((m) => (
                  <p key={m.codigo} className="text-muted-foreground">
                    <Badge variant="aviso">{m.codigo}</Badge> {m.detalhe}
                  </p>
                ))}
              </Card>
            </li>
          ))}
          {reprovadas.length === 0 ? (
            <Card className="p-6 text-sm text-muted-foreground">Nenhuma reprovação.</Card>
          ) : null}
        </ul>
      ) : (
        <ul className="flex flex-col gap-2">
          {(aba === "enviadas" ? enviados : problemas).map((e) => (
            <li key={e.id}>
              <Card className="flex flex-col gap-1 p-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/ofertas/${e.ofertaId}`} className="font-medium hover:underline">
                    {e.produto}
                  </Link>
                  <Badge
                    variant={
                      e.status === "enviado" ? "default" : e.status === "agendado" ? "secondary" : "aviso"
                    }
                  >
                    {e.status}
                  </Badge>
                  {e.extra ? <Badge variant="outline">extra</Badge> : null}
                  {e.ensaio ? <Badge variant="outline">ensaio</Badge> : null}
                </div>
                <p className="text-muted-foreground">
                  {e.grupo} · {hora(e.enviadoEm ?? e.agendadoPara)}
                  {e.numero ? ` · pelo ${e.numero}` : ""}
                </p>
                {e.erro ? <p className="text-muted-foreground">{e.erro}</p> : null}
              </Card>
            </li>
          ))}
          {(aba === "enviadas" ? enviados : problemas).length === 0 ? (
            <Card className="p-6 text-sm text-muted-foreground">Nada nos últimos 7 dias.</Card>
          ) : null}
        </ul>
      )}
    </div>
  );
}
