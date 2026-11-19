"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";

/** Botão que pede confirmação num <dialog> nativo antes de agir. */
export function Confirmar({
  rotulo,
  titulo,
  texto,
  confirmar,
  aoConfirmar,
  variante = "default",
  grande = false,
}: {
  rotulo: string;
  titulo: string;
  texto: string;
  confirmar: string;
  aoConfirmar?: () => void | Promise<void>;
  variante?: "default" | "outline";
  grande?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [ocupado, setOcupado] = useState(false);
  return (
    <>
      <Button
        variant={variante}
        size={grande ? "lg" : "default"}
        className={grande ? "w-full sm:w-auto" : undefined}
        onClick={() => ref.current?.showModal()}
      >
        {rotulo}
      </Button>
      <dialog
        ref={ref}
        className="m-auto w-[min(92vw,420px)] rounded-xl border bg-card p-0 text-card-foreground backdrop:bg-black/40"
      >
        <div className="flex flex-col gap-3 p-5">
          <h2 className="text-lg font-semibold">{titulo}</h2>
          <p className="text-sm text-muted-foreground">{texto}</p>
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => ref.current?.close()}>
              Cancelar
            </Button>
            <Button
              disabled={ocupado}
              onClick={async () => {
                setOcupado(true);
                try {
                  await aoConfirmar?.();
                } finally {
                  setOcupado(false);
                  ref.current?.close();
                }
              }}
            >
              {confirmar}
            </Button>
          </div>
        </div>
      </dialog>
    </>
  );
}
