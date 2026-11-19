import { AvisoErro } from "@/components/aviso-erro";
import { Cabecalho } from "@/components/cabecalho";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { brl, type Grupo, type Nicho } from "@/lib/tipos";
import { worker } from "@/lib/worker";
import { alternarNicho, salvarNicho } from "../acoes";

export const dynamic = "force-dynamic";

function Campo({
  nome,
  rotulo,
  valor,
  tipo = "text",
  dica,
}: {
  nome: string;
  rotulo: string;
  valor?: string | number | null;
  tipo?: string;
  dica?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={nome}>{rotulo}</Label>
      <Input
        id={nome}
        name={nome}
        type={tipo}
        step={tipo === "number" ? "any" : undefined}
        defaultValue={valor ?? ""}
      />
      {dica ? <span className="text-xs text-muted-foreground">{dica}</span> : null}
    </div>
  );
}

function Formulario({ n }: { n?: Nicho }) {
  return (
    <form action={salvarNicho} className="grid gap-3 sm:grid-cols-2">
      <Campo
        nome="nome"
        rotulo="Nome"
        valor={n?.nome}
        dica={n ? "O nome identifica o nicho; mudar cria outro." : undefined}
      />
      <div className="flex flex-col gap-1 sm:col-span-2">
        <Label htmlFor="palavras">Palavras-chave (uma por linha)</Label>
        <textarea
          id="palavras"
          name="palavras"
          rows={4}
          defaultValue={n?.palavras.join("\n") ?? ""}
          className="rounded-md border bg-background p-2 text-sm"
        />
      </div>
      <Campo nome="precoMin" rotulo="Preço mínimo (R$)" valor={n?.precoMin} tipo="number" />
      <Campo nome="precoMax" rotulo="Preço máximo (R$)" valor={n?.precoMax} tipo="number" />
      <Campo
        nome="descontoMinPct"
        rotulo="Desconto mínimo sobre a mediana (%)"
        valor={n?.descontoMinPct ?? 20}
        tipo="number"
        dica="Vale na próxima rodada do Monitor."
      />
      <Campo nome="avaliacaoMin" rotulo="Nota mínima" valor={n?.avaliacaoMin ?? 4.5} tipo="number" />
      <Campo nome="vendasMin" rotulo="Vendas mínimas" valor={n?.vendasMin ?? 100} tipo="number" />
      <Campo
        nome="template"
        rotulo="Template visual"
        valor={n?.template}
        dica="Chave em TEMPLATES-VISUAIS; vazio usa o nome do nicho."
      />
      <Campo
        nome="modeloLlm"
        rotulo="Modelo de LLM da copy"
        valor={n?.modeloLlm}
        dica="Ex.: openai/gpt-4o-mini; vazio usa o de AGENTES.md."
      />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="ativo" defaultChecked={n?.ativo ?? true} /> Ativo
      </label>
      <div className="sm:col-span-2">
        <Button type="submit">{n ? "Salvar" : "Criar nicho"}</Button>
      </div>
    </form>
  );
}

export default async function Nichos({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const { erro } = await searchParams;
  const [{ nichos }, { grupos }] = await Promise.all([
    worker.get<{ nichos: Nicho[] }>("/nichos"),
    worker.get<{ grupos: Grupo[] }>("/grupos"),
  ]);
  return (
    <div className="flex flex-col gap-5">
      <Cabecalho
        titulo="Nichos"
        descricao="O que o Garimpeiro procura e a régua de oferta real de cada nicho."
      />
      <AvisoErro erro={erro} />
      {nichos.map((n) => {
        const destinos = grupos.filter((g) => g.nichoIds.includes(n.id));
        return (
          <Card key={n.id} className="flex flex-col gap-3 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold">{n.nome}</h2>
              <Badge variant={n.ativo ? "secondary" : "aviso"}>{n.ativo ? "ativo" : "pausado"}</Badge>
              <span className="text-sm text-muted-foreground">
                {n.precoMin ? `${brl(n.precoMin)} a ` : "até "}
                {brl(n.precoMax)} · −{Number(n.descontoMinPct)}% · nota {Number(n.avaliacaoMin)} ·{" "}
                {n.vendasMin} vendas
              </span>
              <form action={alternarNicho} className="ml-auto">
                <input
                  type="hidden"
                  name="nicho"
                  value={JSON.stringify({
                    ...n,
                    precoMin: n.precoMin ? Number(n.precoMin) : null,
                    precoMax: n.precoMax ? Number(n.precoMax) : null,
                    descontoMinPct: Number(n.descontoMinPct),
                    avaliacaoMin: Number(n.avaliacaoMin),
                    marketplace: n.marketplace,
                  })}
                />
                <Button type="submit" variant="outline" size="sm">
                  {n.ativo ? "Pausar" : "Ativar"}
                </Button>
              </form>
            </div>
            <p className="text-sm text-muted-foreground">
              Grupos de destino:{" "}
              {destinos.length ? destinos.map((g) => g.nome).join(", ") : "nenhum (escolha em Grupos)"}
            </p>
            <details>
              <summary className="cursor-pointer text-sm font-medium">Editar</summary>
              <div className="pt-3">
                <Formulario n={n} />
              </div>
            </details>
          </Card>
        );
      })}
      <Card className="flex flex-col gap-3 p-5">
        <h2 className="font-semibold">Novo nicho</h2>
        <Formulario />
      </Card>
    </div>
  );
}
