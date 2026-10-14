"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip, Field, Input, Select, Textarea } from "@/components/ui/form";
import { estimatePostsPerDay, minutesBetween } from "@/lib/estimate";

const DAYS = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];
const CATEGORIES = ["Eletrônicos", "Casa e Cozinha", "Moda Feminina", "Moda Masculina", "Beleza", "Esporte"];

export function AutomationForm({
  groups,
  automationsUsed,
  maxAutomations,
  dailyCap,
}: {
  groups: { id: string; name: string }[];
  automationsUsed: number;
  maxAutomations: number;
  dailyCap: number;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [start, setStart] = useState("08:00");
  const [end, setEnd] = useState("20:00");
  const [freq, setFreq] = useState<15 | 30 | 60>(30);
  const [name, setName] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const est = estimatePostsPerDay({ groups: selected.length, windowStart: start, windowEnd: end, frequencyMin: freq, dailyCap });
  const windowInvalid = end <= start;
  const limitReached = automationsUsed >= maxAutomations;
  const errors = {
    name: submitted && !name.trim() ? "Dê um nome para reconhecer a automação." : undefined,
    groups: submitted && selected.length === 0 ? "Escolha pelo menos um grupo." : undefined,
  };

  return (
    <form
      className="grid items-start gap-6 lg:grid-cols-[1fr_20rem]"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setSubmitted(true);
      }}
    >
      <div className="grid gap-6">
        <Card title="Identificação">
          <Field label="Nome da automação" htmlFor="name" error={errors.name} hint="Só você vê. Ex.: “Eletrônicos até R$ 150”.">
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!errors.name} aria-describedby="name-msg" placeholder="Eletrônicos até R$ 150" />
          </Field>
        </Card>

        <Card title="Filtros de oferta" description="Só entram ofertas que passam em todos os filtros.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Categoria" htmlFor="category">
              <Select id="category" defaultValue="">
                <option value="">Todas</option>
                {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </Select>
            </Field>
            <Field label="Preço máximo (R$)" htmlFor="max-price" hint="Deixe em branco para não limitar.">
              <Input id="max-price" inputMode="decimal" placeholder="150" />
            </Field>
            <Field label="Desconto mínimo (%)" htmlFor="min-discount">
              <Input id="min-discount" inputMode="numeric" defaultValue="30" />
            </Field>
            <Field label="Comissão mínima (%)" htmlFor="min-commission">
              <Input id="min-commission" inputMode="decimal" defaultValue="5" />
            </Field>
            <Field label="Avaliação mínima" htmlFor="min-rating">
              <Select id="min-rating" defaultValue="4.5">
                <option value="0">Qualquer</option>
                <option value="4">4,0 ou mais</option>
                <option value="4.5">4,5 ou mais</option>
                <option value="4.8">4,8 ou mais</option>
              </Select>
            </Field>
            <Field label="Vendas mínimas" htmlFor="min-sales">
              <Input id="min-sales" inputMode="numeric" defaultValue="500" />
            </Field>
          </div>
        </Card>

        <Card title="Quando postar" description="Horários no fuso da conta (America/Cuiaba).">
          <fieldset>
            <legend className="mb-2 text-sm font-semibold text-ink">Dias da semana</legend>
            <div className="flex flex-wrap gap-2">
              {DAYS.map((d) => <Chip key={d} label={d} defaultChecked name="days" value={d} />)}
            </div>
          </fieldset>
          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <Field label="Início da janela" htmlFor="start">
              <Input id="start" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
            </Field>
            <Field label="Fim da janela" htmlFor="end" error={windowInvalid ? "O fim precisa ser depois do início." : undefined}>
              <Input id="end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} aria-invalid={windowInvalid} aria-describedby="end-msg" />
            </Field>
            <Field label="Frequência" htmlFor="freq">
              <Select id="freq" value={freq} onChange={(e) => setFreq(Number(e.target.value) as 15 | 30 | 60)}>
                <option value={15}>A cada 15 min</option>
                <option value={30}>A cada 30 min</option>
                <option value={60}>A cada 60 min</option>
              </Select>
            </Field>
          </div>
        </Card>

        <Card title="Onde postar" description="Só aparecem grupos ativos em Conexões.">
          <fieldset aria-describedby={errors.groups ? "groups-error" : undefined}>
            <legend className="sr-only">Grupos de destino</legend>
            <div className="flex flex-wrap gap-2">
              {groups.map((g) => (
                <Chip
                  key={g.id}
                  label={g.name}
                  checked={selected.includes(g.id)}
                  onChange={(e) => setSelected((cur) => (e.target.checked ? [...cur, g.id] : cur.filter((x) => x !== g.id)))}
                />
              ))}
            </div>
          </fieldset>
          {errors.groups && <p id="groups-error" role="alert" className="mt-2 text-sm text-err">{errors.groups}</p>}
        </Card>

        <Card title="Texto da mensagem" description="Opcional. A imagem, o preço e o link curto entram automaticamente.">
          <div className="grid gap-4">
            <Field label="Cabeçalho" htmlFor="header">
              <Input id="header" placeholder="Achadinho do dia" maxLength={80} />
            </Field>
            <Field label="Rodapé" htmlFor="footer">
              <Textarea id="footer" placeholder="Preço pode mudar a qualquer momento." maxLength={200} rows={2} />
            </Field>
          </div>
        </Card>
      </div>

      <aside className="lg:sticky lg:top-8">
        <Card title="Estimativa">
          <p className="font-display text-4xl font-extrabold tabular-nums text-ink">
            {est.capped}
            <span className="ml-2 text-base font-semibold text-ink-2">posts por dia</span>
          </p>
          <p className="mt-2 text-sm text-ink-2">
            {selected.length} {selected.length === 1 ? "grupo" : "grupos"} × (janela de {minutesBetween(start, end)} min ÷ {freq} min)
          </p>
          {est.hitCap && <div className="mt-3"><Badge tone="warn">Limitado ao teto de {dailyCap}/canal por dia</Badge></div>}
          <p className="mt-4 text-sm text-ink-2">
            Antirrepetição: a mesma oferta não volta ao mesmo grupo por 7 dias.
          </p>
          <div className="mt-5 grid gap-2">
            <Button type="submit" disabled={limitReached || windowInvalid}>Salvar automação</Button>
            <Button type="button" variant="ghost" href="/automacoes">Cancelar</Button>
          </div>
          <p className="mt-3 text-xs text-ink-3">
            {limitReached ? `Limite de ${maxAutomations} automações atingido.` : `${automationsUsed} de ${maxAutomations} automações em uso.`}
          </p>
        </Card>
      </aside>
    </form>
  );
}
