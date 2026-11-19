import { Abas } from "@/components/abas";

export const PERIODOS = [
  { valor: "hoje", rotulo: "Hoje" },
  { valor: "7d", rotulo: "7 dias" },
  { valor: "30d", rotulo: "30 dias" },
] as const;

/** Período das telas de números (padrão: 7 dias). Preserva os outros parâmetros da URL. */
export function Periodo({
  base,
  atual,
  extra = {},
}: {
  base: string;
  atual: string;
  extra?: Record<string, string | undefined>;
}) {
  return (
    <Abas
      ativo={atual}
      itens={PERIODOS.map((p) => {
        const q = new URLSearchParams(
          Object.entries({ ...extra, periodo: p.valor }).filter(([, v]) => v) as [string, string][],
        );
        return { valor: p.valor, rotulo: p.rotulo, href: `${base}?${q}` };
      })}
    />
  );
}
