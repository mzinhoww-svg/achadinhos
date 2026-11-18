import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

/** Filtros por GET (funcionam sem JavaScript): cada campo vira ?nome=valor na URL. */
export function Filtros({
  campos,
  valores,
}: {
  campos: { nome: string; rotulo: string; opcoes: { valor: string; rotulo: string }[] }[];
  valores: Record<string, string | undefined>;
}) {
  return (
    <form className="flex flex-wrap items-end gap-2" method="get">
      {campos.map((c) => (
        <label
          key={c.nome}
          htmlFor={`filtro-${c.nome}`}
          className="flex flex-col gap-1 text-xs text-muted-foreground"
        >
          {c.rotulo}
          <Select id={`filtro-${c.nome}`} name={c.nome} defaultValue={valores[c.nome] ?? ""}>
            <option value="">Todos</option>
            {c.opcoes.map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.rotulo}
              </option>
            ))}
          </Select>
        </label>
      ))}
      <Button type="submit" variant="outline">
        Filtrar
      </Button>
    </form>
  );
}
