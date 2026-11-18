import { Cabecalho } from "@/components/cabecalho";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Grupo, Nicho } from "@/lib/tipos";
import { worker } from "@/lib/worker";
import { criarEntrada, salvarGrupo } from "../acoes";

export const dynamic = "force-dynamic";

function Formulario({ g, nichos }: { g?: Grupo; nichos: Nicho[] }) {
  return (
    <form action={salvarGrupo} className="grid gap-3 sm:grid-cols-2">
      {g ? <input type="hidden" name="id" value={g.id} /> : null}
      <div className="flex flex-col gap-1">
        <Label htmlFor={`nome-${g?.id ?? "novo"}`}>Nome</Label>
        <Input id={`nome-${g?.id ?? "novo"}`} name="nome" defaultValue={g?.nome ?? ""} required />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`jid-${g?.id ?? "novo"}`}>JID do grupo no WhatsApp</Label>
        <Input
          id={`jid-${g?.id ?? "novo"}`}
          name="waJid"
          placeholder="1203…@g.us"
          defaultValue={g?.waJid ?? ""}
        />
        <span className="text-xs text-muted-foreground">
          Os chips do gateway precisam ser admins do grupo.
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`horarios-${g?.id ?? "novo"}`}>Horários (vazio = os da bíblia)</Label>
        <Input
          id={`horarios-${g?.id ?? "novo"}`}
          name="horarios"
          placeholder="08:00, 11:00, 14:00, 17:00, 20:00"
          defaultValue={g?.horarios.join(", ") ?? ""}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`max-${g?.id ?? "novo"}`}>Máximo de mensagens por dia (vazio = bíblia)</Label>
        <Input
          id={`max-${g?.id ?? "novo"}`}
          name="maxPorDia"
          type="number"
          min={1}
          max={50}
          defaultValue={g?.maxPorDia ?? ""}
        />
      </div>
      <div className="flex flex-col gap-1 sm:col-span-2">
        <Label htmlFor={`promessa-${g?.id ?? "novo"}`}>Promessa do grupo</Label>
        <Input id={`promessa-${g?.id ?? "novo"}`} name="promessa" defaultValue={g?.promessa ?? ""} />
      </div>
      <fieldset className="flex flex-wrap gap-3 text-sm sm:col-span-2">
        <legend className="mb-1 text-sm font-medium">Nichos que vão para este grupo</legend>
        {nichos.map((n) => (
          <label key={n.id} className="flex items-center gap-1.5">
            <input type="checkbox" name="nichoIds" value={n.id} defaultChecked={g?.nichoIds.includes(n.id)} />{" "}
            {n.nome}
          </label>
        ))}
      </fieldset>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="teste" defaultChecked={g?.teste ?? false} /> Grupo de teste (recebe as
        ofertas de ensaio)
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="ativo" defaultChecked={g?.ativo ?? !g} /> Ativo (recebe envios)
      </label>
      <div className="sm:col-span-2">
        <Button type="submit">{g ? "Salvar" : "Criar grupo"}</Button>
      </div>
    </form>
  );
}

export default async function Grupos() {
  const [{ grupos }, { nichos }] = await Promise.all([
    worker.get<{ grupos: Grupo[] }>("/grupos"),
    worker.get<{ nichos: Nicho[] }>("/nichos"),
  ]);
  const convites = await Promise.all(
    grupos.map((g) =>
      g.waJid
        ? worker
            .get<{ convite: string }>(`/grupos/${g.id}/convite`)
            .then((r) => r.convite)
            .catch(() => null)
        : Promise.resolve(null),
    ),
  );
  return (
    <div className="flex flex-col gap-5">
      <Cabecalho titulo="Grupos" descricao="Para onde as ofertas vão, quando e com que limite." />
      {grupos.map((g, i) => (
        <Card key={g.id} className="flex flex-col gap-3 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold">{g.nome}</h2>
            <Badge variant={g.ativo ? "secondary" : "aviso"}>{g.ativo ? "ativo" : "inativo"}</Badge>
            {g.teste ? <Badge variant="outline">teste</Badge> : <Badge>real</Badge>}
            {!g.waJid ? <Badge variant="aviso">sem JID</Badge> : null}
          </div>
          <p className="text-sm text-muted-foreground">
            Horários: {g.horarios.length ? g.horarios.join(", ") : "os da bíblia"} · máximo{" "}
            {g.maxPorDia ?? "da bíblia"} por dia
          </p>
          <div className="flex flex-col gap-1 text-sm">
            <span>
              Convite:{" "}
              {convites[i] ? (
                <a href={convites[i] ?? undefined} className="text-primary hover:underline">
                  {convites[i]}
                </a>
              ) : (
                <span className="text-muted-foreground">
                  disponível quando um chip admin estiver conectado
                </span>
              )}
            </span>
            <span>
              Entrada por wa.me:{" "}
              {g.linkEntrada ? (
                <a href={g.linkEntrada} className="break-all text-primary hover:underline">
                  {g.linkEntrada}
                </a>
              ) : (
                <span className="text-muted-foreground">ainda não criada</span>
              )}
            </span>
          </div>
          <details>
            <summary className="cursor-pointer text-sm font-medium">Editar</summary>
            <div className="pt-3">
              <Formulario g={g} nichos={nichos} />
            </div>
          </details>
          {g.waJid ? (
            <details>
              <summary className="cursor-pointer text-sm font-medium">Criar link wa.me de entrada</summary>
              <form action={criarEntrada} className="grid gap-3 pt-3 sm:grid-cols-3">
                <input type="hidden" name="grupoId" value={g.id} />
                <div className="flex flex-col gap-1">
                  <Label htmlFor={`chave-${g.id}`}>Chave</Label>
                  <Input id={`chave-${g.id}`} name="chave" placeholder="casa-instagram" required />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor={`origem-${g.id}`}>Origem</Label>
                  <Input id={`origem-${g.id}`} name="origem" placeholder="instagram" required />
                </div>
                <div className="flex flex-col gap-1 sm:col-span-3">
                  <Label htmlFor={`msg-${g.id}`}>Mensagem pronta</Label>
                  <Input
                    id={`msg-${g.id}`}
                    name="mensagem"
                    defaultValue="Quero entrar no grupo de ofertas de casa"
                    required
                  />
                </div>
                <div>
                  <Button type="submit" variant="outline">
                    Gerar link
                  </Button>
                </div>
              </form>
            </details>
          ) : null}
        </Card>
      ))}
      <Card className="flex flex-col gap-3 p-5">
        <h2 className="font-semibold">Novo grupo</h2>
        <Formulario nichos={nichos} />
      </Card>
    </div>
  );
}
