import { Cabecalho } from "@/components/cabecalho";
import { Confirmar } from "@/components/confirmar";
import { FaixaDemo } from "@/components/faixa-demo";
import { StatusDot } from "@/components/status-dot";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { brl, NICHOS } from "@/lib/demo";

export default function Nichos() {
  return (
    <div className="flex flex-col gap-5">
      <Cabecalho
        titulo="Nichos"
        descricao="O que o Garimpeiro busca. Cada mudança vira evento e entra na auditoria."
        acao={
          <Confirmar
            rotulo="Novo nicho"
            titulo="Novo nicho"
            texto="Nome, faixa de preço e palavras-chave. (Demonstração: o cadastro real chega com as rotas de nichos do worker.)"
            confirmar="Entendi"
          />
        }
      />
      <FaixaDemo motivo="O cadastro real usa as tabelas nichos e palavras_chave." />
      <ul className="grid gap-3 md:grid-cols-2">
        {NICHOS.map((n) => (
          <li key={n.id}>
            <Card className="flex flex-col gap-3 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">{n.nome}</p>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <StatusDot tipo={n.ativo ? "ok" : "neutro"} />
                  {n.ativo ? "ativo" : "desligado"}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                {n.marketplace} · {brl(n.precoMin)} a {brl(n.precoMax)}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {n.palavras.map((p) => (
                  <Badge key={p} variant="outline">
                    {p}
                  </Badge>
                ))}
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
