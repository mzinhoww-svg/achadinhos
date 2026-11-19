import type * as React from "react";
import { cn } from "@/lib/utils";

export function Label({ className, ...props }: React.ComponentProps<"label">) {
  // biome-ignore lint/a11y/noLabelWithoutControl: o controle é associado por htmlFor em quem usa.
  return <label data-slot="label" className={cn("text-sm font-medium leading-none", className)} {...props} />;
}
