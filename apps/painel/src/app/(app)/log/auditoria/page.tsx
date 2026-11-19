import Link from "next/link";
import { Cabecalho } from "@/components/cabecalho";
import { IconeVoltar } from "@/components/icones";
import { Table, TBody, Td, THead, Th, Tr } from "@/components/ui/table";
import { hora, type RegistroAuditoria } from "@/lib/tipos";
import { worker } from "@/lib/worker";

export const dynamic = "force-dynamic";

/** T6.9: toda ação feita no painel (e as pausas automáticas) fica registrada aqui. */
export default async function Auditoria() {
  const { registros } = await worker.get<{ registros: RegistroAuditoria[] }>("/auditoria?limite=200");
  return (
    <div className="flex flex-col gap-5">
      <Link
        href="/log"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <IconeVoltar className="size-4" /> Log dos agentes
      </Link>
      <Cabecalho
        titulo="Auditoria"
        descricao="Quem fez o quê no painel, e as pausas e retomadas do sistema."
      />
      <Table>
        <THead>
          <Tr>
            <Th>Quando</Th>
            <Th>Quem</Th>
            <Th>Ação</Th>
            <Th>Alvo</Th>
          </Tr>
        </THead>
        <TBody>
          {registros.map((r) => (
            <Tr key={r.id}>
              <Td className="text-xs">{hora(r.criadoEm)}</Td>
              <Td>{r.ator}</Td>
              <Td className="font-mono text-xs">{r.acao}</Td>
              <Td className="text-xs text-muted-foreground">{r.alvo ?? "—"}</Td>
            </Tr>
          ))}
          {registros.length === 0 ? (
            <Tr>
              <Td colSpan={4} className="text-muted-foreground">
                Nada registrado ainda.
              </Td>
            </Tr>
          ) : null}
        </TBody>
      </Table>
    </div>
  );
}
