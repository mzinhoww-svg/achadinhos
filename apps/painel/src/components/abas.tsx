import Link from "next/link";
import { cn } from "@/lib/utils";

/** Abas como links (o estado fica na URL). */
export function Abas({
  itens,
  ativo,
}: {
  itens: { href: string; rotulo: string; valor: string }[];
  ativo: string;
}) {
  return (
    <nav className="flex w-fit flex-wrap gap-1 rounded-lg bg-muted p-1 text-sm">
      {itens.map((i) => (
        <Link
          key={i.valor}
          href={i.href}
          className={cn(
            "rounded-md px-3 py-1.5 text-muted-foreground",
            i.valor === ativo && "bg-background font-medium text-foreground shadow-sm",
          )}
        >
          {i.rotulo}
        </Link>
      ))}
    </nav>
  );
}
