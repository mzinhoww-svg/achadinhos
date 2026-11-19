import { Cabecalho } from "@/components/cabecalho";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { worker } from "@/lib/worker";

export const dynamic = "force-dynamic";

interface Agentes {
  mcpUrl: string;
  agentes: { nome: string; token: string; ferramentas: string[] }[];
}

/** Configuração dos agentes no OpenBot (T7.1): um servidor MCP por agente, cada um com o seu token. */
export default async function PaginaAgentes() {
  const a = await worker.get<Agentes>("/agentes");
  return (
    <div className="flex flex-col gap-5">
      <Cabecalho
        titulo="Agentes"
        descricao="Como ligar cada agente do OpenBot ao worker. Cada um só enxerga as ferramentas da sua função."
      />
      <Card className="flex flex-col gap-2 p-5 text-sm">
        <p>
          No OpenBot: <strong>Settings › MCP servers › Add</strong>, tipo <strong>HTTP</strong>, URL{" "}
          <code className="rounded bg-muted px-1">{a.mcpUrl}</code>, header{" "}
          <code className="rounded bg-muted px-1">Authorization</code> com{" "}
          <code className="rounded bg-muted px-1">Bearer</code> e o token do agente. Dê acesso a esse servidor
          só ao agente correspondente.
        </p>
        <p className="text-muted-foreground">
          Os tokens são como senhas: não cole na conversa com os agentes, só na tela de MCP do OpenBot.
        </p>
      </Card>
      <div className="grid gap-3 sm:grid-cols-2">
        {a.agentes.map((ag) => (
          <Card key={ag.nome} className="flex flex-col gap-3 p-5">
            <h2 className="font-semibold">{ag.nome}</h2>
            <div className="flex flex-wrap gap-1">
              {ag.ferramentas.map((f) => (
                <Badge key={f} variant="outline">
                  {f}
                </Badge>
              ))}
            </div>
            <details className="text-sm">
              <summary className="cursor-pointer font-medium">Mostrar configuração</summary>
              <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3 text-xs">
                {JSON.stringify(
                  {
                    [`achadinhos-${ag.nome.toLowerCase().replace(/\s+/g, "-")}`]: {
                      type: "http",
                      url: a.mcpUrl,
                      headers: { Authorization: `Bearer ${ag.token}` },
                    },
                  },
                  null,
                  2,
                )}
              </pre>
            </details>
          </Card>
        ))}
      </div>
    </div>
  );
}
