import type * as React from "react";
import { cn } from "@/lib/utils";

/** Select nativo com a aparência do design system (acessível e leve no celular). */
export function Select({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-10 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        className,
      )}
      {...props}
    />
  );
}
