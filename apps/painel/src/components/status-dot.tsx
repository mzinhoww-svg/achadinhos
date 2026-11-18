import { cn } from "@/lib/utils";

const CORES = {
  ok: "bg-emerald-500",
  aviso: "bg-amber-500",
  erro: "bg-destructive",
  neutro: "bg-muted-foreground/50",
} as const;

export function StatusDot({ tipo, className }: { tipo: keyof typeof CORES; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block size-2 shrink-0 rounded-full", CORES[tipo], className)}
    />
  );
}
