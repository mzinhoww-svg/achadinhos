import { Abas } from "@/components/abas";

export function AbasBiblia({ ativo, abertas }: { ativo: "docs" | "propostas"; abertas?: number }) {
  return (
    <Abas
      ativo={ativo}
      itens={[
        { valor: "docs", rotulo: "Documentos", href: "/biblia" },
        {
          valor: "propostas",
          rotulo: abertas ? `Propostas (${abertas})` : "Propostas",
          href: "/biblia/propostas",
        },
      ]}
    />
  );
}
