import { redirect } from "next/navigation";
import { sessaoAtual } from "@/lib/auth";
import { FormLogin } from "./form";

export const dynamic = "force-dynamic";

export default async function PaginaLogin() {
  if (await sessaoAtual()) redirect("/");
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-5">
      <div>
        <p className="text-sm font-medium text-primary">Achadinhos</p>
        <h1 className="text-2xl font-semibold">Entrar no painel</h1>
      </div>
      <FormLogin />
    </main>
  );
}
