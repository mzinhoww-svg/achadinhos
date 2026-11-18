import { Cabecalho } from "@/components/cabecalho";
import { Confirmar } from "@/components/confirmar";
import { FaixaDemo } from "@/components/faixa-demo";
import { StatusDot } from "@/components/status-dot";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, Td, THead, Th, Tr } from "@/components/ui/table";
import { GRUPOS } from "@/lib/demo";

export default function Grupos() {
  return (
    <div className="flex flex-col gap-5">
      <Cabecalho
        titulo="Grupos"
        descricao="Onde as ofertas são publicadas, com horários e limite por dia."
        acao={
          <Confirmar
            rotulo="Novo grupo"
            titulo="Novo grupo"
            texto="Nome, promessa, nichos, horários, máximo por dia e link de entrada. (Demonstração.)"
            confirmar="Entendi"
          />
        }
      />
      <FaixaDemo motivo="O cadastro real usa as tabelas grupos e grupo_nichos." />
      <Table>
        <THead>
          <Tr>
            <Th>Grupo</Th>
            <Th>Nichos</Th>
            <Th>Horários</Th>
            <Th className="text-right">Máx./dia</Th>
            <Th className="text-right">Membros</Th>
            <Th>Status</Th>
          </Tr>
        </THead>
        <TBody>
          {GRUPOS.map((g) => (
            <Tr key={g.id}>
              <Td className="min-w-48">
                <p className="font-medium">
                  {g.nome} {g.teste ? <Badge variant="aviso">teste</Badge> : null}
                </p>
                <p className="text-xs text-muted-foreground">{g.promessa}</p>
              </Td>
              <Td className="min-w-40 text-xs">{g.nichos.join(", ")}</Td>
              <Td className="whitespace-nowrap text-xs">{g.horarios.join(" · ")}</Td>
              <Td className="text-right tabular-nums">{g.maxDia}</Td>
              <Td className="text-right tabular-nums">{g.membros}</Td>
              <Td>
                <span className="flex items-center gap-1.5 text-xs">
                  <StatusDot tipo={g.ativo ? "ok" : "neutro"} /> {g.ativo ? "ativo" : "desligado"}
                </span>
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </div>
  );
}
