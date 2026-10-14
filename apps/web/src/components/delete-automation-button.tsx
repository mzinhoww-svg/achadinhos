"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteAutomationAction } from "@/app/automacoes/actions";
import { Button } from "@/components/ui/button";

export function DeleteAutomationButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <>
      <Button
        variant="danger"
        loading={pending}
        onClick={() =>
          start(async () => {
            const r = await deleteAutomationAction(id);
            if (r.ok) router.push("/automacoes");
            else setError(r.message);
          })
        }
      >
        Excluir
      </Button>
      {error && <span role="alert" className="text-sm text-err">{error}</span>}
    </>
  );
}
