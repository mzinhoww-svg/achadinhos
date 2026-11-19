/** Aviso de falha de uma ação do painel (vem em ?erro=). */
export function AvisoErro({ erro }: { erro?: string | undefined }) {
  if (!erro) return null;
  return (
    <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
      <p className="font-medium">Não deu certo.</p>
      <p className="text-muted-foreground">{erro}</p>
    </div>
  );
}
