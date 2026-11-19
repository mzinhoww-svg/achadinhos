"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function Erro({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Card className="flex flex-col gap-3 p-6">
      <h1 className="font-semibold">Algo falhou</h1>
      <p className="text-sm text-muted-foreground">
        {error.message || "Erro inesperado."} Se persistir, confira se o worker está no ar na Vertra.
      </p>
      <Button onClick={reset} variant="outline" className="w-fit">
        Tentar de novo
      </Button>
    </Card>
  );
}
