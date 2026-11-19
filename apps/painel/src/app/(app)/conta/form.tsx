"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trocarSenha } from "./acoes";

export function FormSenha() {
  const [estado, acao, pendente] = useActionState(trocarSenha, { erro: null, ok: false });
  return (
    <form action={acao} className="flex max-w-sm flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="atual">Senha atual</Label>
        <Input id="atual" name="atual" type="password" autoComplete="current-password" required />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="nova">Senha nova (mínimo 12 caracteres)</Label>
        <Input id="nova" name="nova" type="password" autoComplete="new-password" minLength={12} required />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="confirma">Repita a senha nova</Label>
        <Input
          id="confirma"
          name="confirma"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
        />
      </div>
      {estado.erro ? (
        <p role="alert" className="text-sm text-destructive">
          {estado.erro}
        </p>
      ) : null}
      {estado.ok ? (
        <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">
          Senha trocada. Use a nova no próximo login.
        </p>
      ) : null}
      <Button type="submit" disabled={pendente} className="w-fit">
        {pendente ? "Trocando…" : "Trocar senha"}
      </Button>
    </form>
  );
}
