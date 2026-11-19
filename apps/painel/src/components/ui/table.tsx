import type * as React from "react";
import { cn } from "@/lib/utils";

export function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div className="w-full overflow-x-auto rounded-xl border bg-card">
      <table className={cn("w-full caption-bottom text-sm", className)} {...props} />
    </div>
  );
}
export function THead(props: React.ComponentProps<"thead">) {
  return <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground" {...props} />;
}
export function TBody(props: React.ComponentProps<"tbody">) {
  return <tbody className="[&_tr:last-child]:border-0" {...props} />;
}
export function Tr({ className, ...props }: React.ComponentProps<"tr">) {
  return <tr className={cn("border-b", className)} {...props} />;
}
export function Th({ className, ...props }: React.ComponentProps<"th">) {
  return <th className={cn("h-10 whitespace-nowrap px-3 font-medium", className)} {...props} />;
}
export function Td({ className, ...props }: React.ComponentProps<"td">) {
  return <td className={cn("px-3 py-2.5 align-middle", className)} {...props} />;
}
