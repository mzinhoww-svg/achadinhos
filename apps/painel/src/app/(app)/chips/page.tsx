import { Cabecalho } from "@/components/cabecalho";
import { Confirmar } from "@/components/confirmar";
import { FaixaDemo } from "@/components/faixa-demo";
import { StatusDot } from "@/components/status-dot";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TBody, Td, THead, Th, Tr } from "@/components/ui/table";
import { CHIPS, QUEDAS } from "@/lib/demo";

const TIPO = { conectado: "ok", aquecendo: "aviso", desconectado: "erro", banido: "erro" } as const;

export default function Chips() {
  const reserva = CHIPS.find((c) => c.papel === "reserva" && c.status === "conectado");
  return (
    <div className="flex flex-col gap-5">
      <Cabecalho
        titulo="Chips do WhatsApp"
        descricao="O número ativo e os reservas. O failover troca sozinho e avisa você."
        acao={
          reserva ? (
            <Confirmar
              rotulo="Trocar o ativo"
              titulo={`Promover ${reserva.apelido} a ativo?`}
              texto="O chip atual vira reserva e os próximos envios saem pelo novo. (Demonstração: nada muda.)"
              confirmar="Trocar"
            />
          ) : null
        }
      />
      <FaixaDemo motivo="O status real chega com a ferramenta /numeros e o wa-gateway." />
      <ul className="grid gap-3 sm:grid-cols-3">
        {CHIPS.map((c) => (
          <li key={c.apelido}>
            <Card className="flex flex-col gap-2 p-4">
              <div className="flex items-center justify-between">
                <p className="font-medium">{c.apelido}</p>
                <Badge variant={c.papel === "ativo" ? "default" : "outline"}>{c.papel}</Badge>
              </div>
              <p className="flex items-center gap-1.5 text-sm">
                <StatusDot tipo={TIPO[c.status]} /> {c.status}
              </p>
              <p className="text-xs text-muted-foreground">
                {c.final} · último envio {c.ultimoEnvio}
              </p>
            </Card>
          </li>
        ))}
        <li>
          <Card className="flex h-full flex-col items-start justify-center gap-2 border-dashed p-4">
            <p className="text-sm text-muted-foreground">Chip novo?</p>
            <Confirmar
              variante="outline"
              rotulo="Parear por QR"
              titulo="Parear um chip novo"
              texto="Abre o QR do wa-gateway para escanear no WhatsApp do chip. (Demonstração.)"
              confirmar="Entendi"
            />
          </Card>
        </li>
      </ul>
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Histórico de quedas</h2>
        <Table>
          <THead>
            <Tr>
              <Th>Quando</Th>
              <Th>Caiu</Th>
              <Th>Assumiu</Th>
              <Th>Fora</Th>
              <Th>Motivo</Th>
            </Tr>
          </THead>
          <TBody>
            {QUEDAS.map((q) => (
              <Tr key={q.quando}>
                <Td className="whitespace-nowrap">{q.quando}</Td>
                <Td>{q.caiu}</Td>
                <Td>{q.assumiu}</Td>
                <Td>{q.fora}</Td>
                <Td className="min-w-48">{q.motivo}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </section>
    </div>
  );
}
