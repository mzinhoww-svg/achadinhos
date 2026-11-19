"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { entrar } from "./acoes";

export function FormLogin() {
  const [estado, acao, pendente] = useActionState(entrar, { erro: null, email: "" });
  return (
    <form action={acao} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">E-mail</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          defaultValue={estado.email}
          key={estado.email}
          required
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="senha">Senha</Label>
        <Input id="senha" name="senha" type="password" autoComplete="current-password" required />
      </div>
      {estado.erro ? (
        <p role="alert" className="text-sm text-destructive">
          {estado.erro}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={pendente}>
        {pendente ? "Entrando…" : "Entrar"}
      </Button>
    </form>
  );
}
