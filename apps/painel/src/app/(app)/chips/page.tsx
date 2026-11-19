import { AvisoErro } from "@/components/aviso-erro";
import { Cabecalho } from "@/components/cabecalho";
import { StatusDot } from "@/components/status-dot";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TBody, Td, THead, Th, Tr } from "@/components/ui/table";
import { hora, type NumeroGateway } from "@/lib/tipos";
import { worker } from "@/lib/worker";
import { adicionarNumero, promoverNumero, salvarTelefonesDono } from "../acoes";
import { LinkPareamento } from "./pareamento";

export const dynamic = "force-dynamic";

export default async function Chips({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const { erro } = await searchParams;
  const r = await worker
    .get<{ numeros: NumeroGateway[] }>("/numeros")
    .catch((e: Error) => ({ erro: e.message }));
  return (
    <div className="flex flex-col gap-5">
      <Cabecalho
        titulo="Chips do WhatsApp"
        descricao="O número ativo e os reservas. O failover troca sozinho e avisa você."
      />
      <AvisoErro erro={erro} />
      {"erro" in r ? (
        <Card className="p-5 text-sm text-muted-foreground">wa-gateway: {r.erro}</Card>
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>Chip</Th>
              <Th>Papel</Th>
              <Th>Conexão</Th>
              <Th>Último sinal</Th>
              <Th>Aquecimento</Th>
              <Th />
            </Tr>
          </THead>
          <TBody>
            {r.numeros.map((n) => (
              <Tr key={n.instanceId}>
                <Td>
                  <span className="flex items-center gap-2">
                    <StatusDot
                      tipo={
                        n.conexao === "open"
                          ? "ok"
                          : n.papel === "banido" || n.papel === "bloqueado"
                            ? "erro"
                            : "aviso"
                      }
                    />
                    {n.instanceId}
                    {n.telefone ? (
                      <span className="text-xs text-muted-foreground">…{n.telefone.slice(-4)}</span>
                    ) : null}
                  </span>
                </Td>
                <Td>
                  <Badge
                    variant={n.papel === "ativo" ? "default" : n.papel === "reserva" ? "secondary" : "aviso"}
                  >
                    {n.papel}
                  </Badge>
                  {n.motivo ? <span className="block text-xs text-muted-foreground">{n.motivo}</span> : null}
                </Td>
                <Td>{n.conexao === "open" ? "conectado" : n.aguardandoQr ? "aguardando QR" : n.conexao}</Td>
                <Td className="text-xs">{hora(n.ultimoHeartbeat)}</Td>
                <Td className="text-xs">
                  dia {n.aquecimento.dias + 1} · {n.aquecimento.enviadosHoje}/{n.aquecimento.tetoDiario} hoje
                </Td>
                <Td className="flex gap-2">
                  {n.conexao !== "open" && n.papel !== "bloqueado" ? (
                    <LinkPareamento instanceId={n.instanceId} />
                  ) : null}
                  {n.papel === "reserva" && n.conexao === "open" ? (
                    <form action={promoverNumero}>
                      <input type="hidden" name="instanceId" value={n.instanceId} />
                      <Button type="submit" variant="outline" size="sm">
                        Promover
                      </Button>
                    </form>
                  ) : null}
                </Td>
              </Tr>
            ))}
            {r.numeros.length === 0 ? (
              <Tr>
                <Td colSpan={6} className="text-muted-foreground">
                  Nenhum chip ainda. Adicione abaixo e escaneie o QR no celular do chip.
                </Td>
              </Tr>
            ) : null}
          </TBody>
        </Table>
      )}
      <section className="grid gap-3 sm:grid-cols-2">
        <Card className="flex flex-col gap-3 p-5">
          <h2 className="font-semibold">Adicionar chip</h2>
          <form action={adicionarNumero} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="instanceId">Apelido (letras minúsculas, números e hífen)</Label>
              <Input
                id="instanceId"
                name="instanceId"
                placeholder="ach-1"
                autoCapitalize="none" autoCorrect="off" spellCheck={false}
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="ordem">Ordem na fila de reserva</Label>
              <Input id="ordem" name="ordem" type="number" min={0} max={99} defaultValue={0} />
            </div>
            <Button type="submit">Adicionar e gerar QR</Button>
          </form>
        </Card>
        <Card className="flex flex-col gap-3 p-5">
          <h2 className="font-semibold">Seu número pessoal</h2>
          <p className="text-sm text-muted-foreground">
            Recebe alertas e o resumo do dia, e aceita PAUSAR e RETOMAR. Ele nunca conecta no gateway: se for
            pareado, é desligado.
          </p>
          <form action={salvarTelefonesDono} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="telefones">Telefone com DDI e DDD (só números)</Label>
              <Input id="telefones" name="telefones" placeholder="5565999990000" required />
            </div>
            <Button type="submit" variant="outline">
              Salvar
            </Button>
          </form>
        </Card>
      </section>
    </div>
  );
}
