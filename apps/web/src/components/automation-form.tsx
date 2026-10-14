"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { saveAutomationAction } from "@/app/automacoes/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip, Field, Input, Select, Textarea } from "@/components/ui/form";
import { estimatePostsPerDay, minutesBetween } from "@/lib/estimate";

const DAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const CATEGORIES = ["Eletrônicos", "Casa e Cozinha", "Moda Feminina", "Moda Masculina", "Beleza", "Esporte"];

export interface AutomationFormInitial {
  id?: string;
  name: string;
  days: number[];
  windowStart: string;
  windowEnd: string;
  frequencyMin: 15 | 30 | 60;
  groupIds: string[];
  header: string;
  footer: string;
  category: string;
  maxPrice: string;
  minDiscount: string;
  minCommission: string;
  minRating: string;
  minSales: string;
}

export const EMPTY_AUTOMATION: AutomationFormInitial = {
  name: "",
  days: [1, 2, 3, 4, 5, 6, 0],
  windowStart: "08:00",
  windowEnd: "20:00",
  frequencyMin: 30,
  groupIds: [],
  header: "",
  footer: "",
  category: "",
  maxPrice: "",
  minDiscount: "30",
  minCommission: "5",
  minRating: "4.5",
  minSales: "500",
};

export function AutomationForm({
  groups,
  automationsUsed,
  maxAutomations,
  dailyCap,
  initial = EMPTY_AUTOMATION,
}: {
  groups: { id: string; name: string }[];
  automationsUsed: number;
  maxAutomations: number;
  dailyCap: number;
  initial?: AutomationFormInitial;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(saveAutomationAction, null);
  const [selected, setSelected] = useState<string[]>(initial.groupIds);
  const [start, setStart] = useState(initial.windowStart);
  const [end, setEnd] = useState(initial.windowEnd);
  const [freq, setFreq] = useState<15 | 30 | 60>(initial.frequencyMin);

  useEffect(() => {
    if (state?.ok) router.push("/automacoes");
  }, [state, router]);

  const est = estimatePostsPerDay({ groups: selected.length, windowStart: start, windowEnd: end, frequencyMin: freq, dailyCap });
  const windowInvalid = start === end;
  const editing = Boolean(initial.id);
  const limitReached = !editing && automationsUsed >= maxAutomations;
  const errors: Record<string, string> = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  const errorList = Object.values(errors);
  const failure = state && !state.ok ? state : null;
  const summaryRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (failure) summaryRef.current?.focus();
  }, [failure]);

  return (
    <form action={action} className="grid items-start gap-6 lg:grid-cols-[1fr_20rem]" noValidate>
      {failure && (
        <div
          ref={summaryRef}
          tabIndex={-1}
          data-error-summary
          role="alert"
          aria-live="assertive"
          className="rounded-panel border border-err/40 bg-err-50 p-4 text-sm text-err lg:col-span-2"
        >
          <p className="font-semibold">{failure.message}</p>
          {errorList.length > 0 && (
            <ul className="mt-1.5 list-disc pl-5">
              {errorList.map((m, i) => <li key={i}>{m}</li>)}
            </ul>
          )}
        </div>
      )}
      {initial.id && <input type="hidden" name="id" value={initial.id} />}
      <div className="grid gap-6">
        <Card title="Identificação">
          <Field label="Nome da automação" htmlFor="name" error={errors.name} hint="Só você vê. Ex.: “Eletrônicos até R$ 150”.">
            <Input id="name" name="name" defaultValue={initial.name} aria-invalid={!!errors.name} aria-describedby="name-msg" placeholder="Eletrônicos até R$ 150" maxLength={120} />
          </Field>
        </Card>

        <Card title="Filtros de oferta" description="Só entram ofertas que passam em todos os filtros.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Categoria" htmlFor="category" error={errors.category}>
              <Select id="category" name="category" defaultValue={initial.category} aria-invalid={!!errors.category} aria-describedby="category-msg">
                <option value="">Todas</option>
                {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </Select>
            </Field>
            <Field label="Preço máximo (R$)" htmlFor="max-price" error={errors.maxPrice} hint="Deixe em branco para não limitar.">
              <Input id="max-price" name="maxPrice" inputMode="decimal" placeholder="150" defaultValue={initial.maxPrice} aria-invalid={!!errors.maxPrice} aria-describedby="max-price-msg" />
            </Field>
            <Field label="Desconto mínimo (%)" htmlFor="min-discount" error={errors.minDiscount}>
              <Input id="min-discount" name="minDiscount" inputMode="numeric" defaultValue={initial.minDiscount} aria-invalid={!!errors.minDiscount} aria-describedby="min-discount-msg" />
            </Field>
            <Field label="Comissão mínima (%)" htmlFor="min-commission" error={errors.minCommission}>
              <Input id="min-commission" name="minCommission" inputMode="decimal" defaultValue={initial.minCommission} aria-invalid={!!errors.minCommission} aria-describedby="min-commission-msg" />
            </Field>
            <Field label="Avaliação mínima" htmlFor="min-rating" error={errors.minRating}>
              <Select id="min-rating" name="minRating" defaultValue={initial.minRating} aria-invalid={!!errors.minRating} aria-describedby="min-rating-msg">
                <option value="0">Qualquer</option>
                <option value="4">4,0 ou mais</option>
                <option value="4.5">4,5 ou mais</option>
                <option value="4.8">4,8 ou mais</option>
              </Select>
            </Field>
            <Field label="Vendas mínimas" htmlFor="min-sales" error={errors.minSales}>
              <Input id="min-sales" name="minSales" inputMode="numeric" defaultValue={initial.minSales} aria-invalid={!!errors.minSales} aria-describedby="min-sales-msg" />
            </Field>
          </div>
        </Card>

        <Card title="Quando postar" description="Horários no fuso da conta (America/Cuiaba).">
          <fieldset>
            <legend className="mb-2 text-sm font-semibold text-ink">Dias da semana</legend>
            <div className="flex flex-wrap gap-2">
              {DAYS.map((d, i) => <Chip key={d} label={d} defaultChecked={initial.days.includes(i)} name="days" value={i} />)}
            </div>
            {errors.days && <p role="alert" aria-live="assertive" className="mt-2 text-sm text-err">{errors.days}</p>}
          </fieldset>
          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <Field label="Início da janela" htmlFor="start" error={errors.windowStart}>
              <Input id="start" name="windowStart" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
            </Field>
            <Field label="Fim da janela" htmlFor="end" error={windowInvalid ? "Início e fim não podem ser iguais." : errors.windowEnd}>
              <Input id="end" name="windowEnd" type="time" value={end} onChange={(e) => setEnd(e.target.value)} aria-invalid={windowInvalid} aria-describedby="end-msg" />
            </Field>
            <Field label="Frequência" htmlFor="freq" error={errors.frequencyMin} hint={end < start ? "A janela termina no dia seguinte." : undefined}>
              <Select id="freq" name="frequencyMin" value={freq} onChange={(e) => setFreq(Number(e.target.value) as 15 | 30 | 60)} aria-invalid={!!errors.frequencyMin} aria-describedby="freq-msg">
                <option value={15}>A cada 15 min</option>
                <option value={30}>A cada 30 min</option>
                <option value={60}>A cada 60 min</option>
              </Select>
            </Field>
          </div>
        </Card>

        <Card title="Onde postar" description="Só aparecem grupos ativos em Conexões.">
          <fieldset aria-describedby={errors.groupIds ? "groups-error" : undefined}>
            <legend className="sr-only">Grupos de destino</legend>
            <div className="flex flex-wrap gap-2">
              {groups.map((g) => (
                <Chip
                  key={g.id}
                  label={g.name}
                  name="groupIds"
                  value={g.id}
                  checked={selected.includes(g.id)}
                  onChange={(e) => setSelected((cur) => (e.target.checked ? [...cur, g.id] : cur.filter((x) => x !== g.id)))}
                />
              ))}
            </div>
          </fieldset>
          {errors.groupIds && <p id="groups-error" role="alert" aria-live="assertive" className="mt-2 text-sm text-err">{errors.groupIds}</p>}
        </Card>

        <Card title="Texto da mensagem" description="Opcional. A imagem, o preço e o link curto entram automaticamente.">
          <div className="grid gap-4">
            <Field label="Cabeçalho" htmlFor="header" error={errors.header}>
              <Input id="header" name="header" placeholder="Achadinho do dia" maxLength={80} defaultValue={initial.header} aria-invalid={!!errors.header} aria-describedby="header-msg" />
            </Field>
            <Field label="Rodapé" htmlFor="footer" error={errors.footer}>
              <Textarea id="footer" name="footer" placeholder="Preço pode mudar a qualquer momento." maxLength={200} rows={2} defaultValue={initial.footer} aria-invalid={!!errors.footer} aria-describedby="footer-msg" />
            </Field>
          </div>
        </Card>
      </div>

      <aside className="lg:sticky lg:top-8">
        <Card title="Estimativa">
          <p className="font-display text-4xl font-extrabold tabular-nums text-ink" aria-live="polite">
            {est.capped}
            <span className="ml-2 text-base font-semibold text-ink-2">posts por dia</span>
          </p>
          <p className="mt-2 text-sm text-ink-2">
            {selected.length} {selected.length === 1 ? "grupo" : "grupos"} × (janela de {minutesBetween(start, end)} min ÷ {freq} min)
          </p>
          {est.hitCap && <div className="mt-3"><Badge tone="warn">Limitado ao teto de {dailyCap}/canal por dia</Badge></div>}
          <p className="mt-4 text-sm text-ink-2">Antirrepetição: a mesma oferta não volta ao mesmo grupo por 7 dias.</p>
          <div className="mt-5 grid gap-2">
            <Button type="submit" loading={pending} disabled={limitReached || windowInvalid}>{editing ? "Salvar alterações" : "Salvar automação"}</Button>
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
