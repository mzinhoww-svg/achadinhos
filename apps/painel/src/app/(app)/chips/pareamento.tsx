"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { gerarPareamento } from "./acoes";

/** Gera o link do QR (10 minutos) e abre numa aba nova, para escanear com o celular do chip. */
export function LinkPareamento({ instanceId }: { instanceId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  if (url)
    return (
      <a href={url} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline">
        abrir QR
      </a>
    );
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={pendente}
        onClick={() =>
          iniciar(async () => {
            const r = await gerarPareamento(instanceId);
            if (r.url) setUrl(r.url);
            else setErro(r.erro);
          })
        }
      >
        {pendente ? "Gerando…" : "QR"}
      </Button>
      {erro ? <span className="text-xs text-muted-foreground">{erro}</span> : null}
    </>
  );
}
