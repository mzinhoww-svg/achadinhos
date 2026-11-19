import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Um número e a comparação com o período anterior. */
export function Kpi({
  rotulo,
  valor,
  anterior,
  formato = (v: number) => String(v),
}: {
  rotulo: string;
  valor: number;
  anterior?: number;
  formato?: (v: number) => string;
}) {
  const delta = anterior ? Math.round(((valor - anterior) / anterior) * 100) : null;
  return (
    <Card className="flex flex-col gap-1 p-4">
      <span className="text-xs text-muted-foreground">{rotulo}</span>
      <span className="text-2xl font-semibold tabular-nums">{formato(valor)}</span>
      {delta !== null ? (
        <span
          className={cn(
            "text-xs",
            delta >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive",
          )}
        >
          {delta >= 0 ? "+" : ""}
          {delta}% contra ontem
        </span>
      ) : null}
    </Card>
  );
}
