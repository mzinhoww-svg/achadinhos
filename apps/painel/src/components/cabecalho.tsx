/** Título da tela, uma frase de contexto e a ação principal (uma por tela). */
export function Cabecalho({
  titulo,
  descricao,
  acao,
}: {
  titulo: string;
  descricao?: string;
  acao?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold">{titulo}</h1>
        {descricao ? <p className="text-sm text-muted-foreground">{descricao}</p> : null}
      </div>
      {acao}
    </div>
  );
}
