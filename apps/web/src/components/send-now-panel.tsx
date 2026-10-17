"use client";

import { productPlaceholder } from "@achadinhos/creative";
import Link from "next/link";
import { useId, useState, useTransition } from "react";
import { previewOfferAction, searchOffersAction, sendNowAction } from "@/app/mandar-agora/actions";
import { CreativePreview } from "@/components/creative-preview";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Chip, Field, Input } from "@/components/ui/form";
import { IconAlert, IconCheck, IconSearch, IconSend } from "@/components/ui/icons";
import { formatBRL, formatInt } from "@/lib/format";
import type { PublicOffer } from "@/server/send-now";

export interface GroupOption {
  id: string;
  name: string;
  active: boolean;
}

interface Preview {
  shortLink: string;
  repeats: { groupId: string; daysAgo: number }[];
}

const imageOf = (o: PublicOffer) => (o.placeholderHue !== undefined ? productPlaceholder(o.placeholderHue, "") : o.imageUrl);

export function SendNowPanel({ groups, affiliateHandle = "achadinhos", showConexoes = false }: { groups: GroupOption[]; affiliateHandle?: string; showConexoes?: boolean }) {
  const searchId = useId();
  const [q, setQ] = useState("");
  const [qError, setQError] = useState<string | undefined>();
  const [offers, setOffers] = useState<PublicOffer[] | null>(null);
  const [selected, setSelected] = useState<PublicOffer | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [searching, startSearch] = useTransition();
  const [previewing, startPreview] = useTransition();
  const [sending, startSend] = useTransition();

  const fail = (text: string) => setMessage({ ok: false, text });
  const activeGroups = groups.filter((g) => g.active);

  function loadPreview(offer: PublicOffer, groupIds: string[]) {
    startPreview(async () => {
      const r = await previewOfferAction(offer.itemId, groupIds);
      if (r.ok) setPreview({ shortLink: r.data.shortLink, repeats: r.data.repeats });
      else {
        setPreview(null);
        fail(r.message);
      }
    });
  }

  function search(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setQError(undefined);
    setSelected(null);
    setPreview(null);
    startSearch(async () => {
      const r = await searchOffersAction(q);
      if (r.ok) setOffers(r.data);
      else if (r.fieldErrors?.q) {
        setOffers(null);
        setQError(r.fieldErrors.q);
      } else {
        setOffers(null);
        fail(r.message);
      }
    });
  }

  function choose(offer: PublicOffer) {
    setSelected(offer);
    setPreview(null);
    setMessage(null);
    loadPreview(offer, picked);
  }

  function toggle(id: string) {
    const next = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
    setPicked(next);
    if (selected) loadPreview(selected, next);
  }

  function send() {
    if (!selected) return;
    setMessage(null);
    startSend(async () => {
      const r = await sendNowAction(selected.itemId, picked);
      if (!r.ok) {
        fail(r.fieldErrors?.groupIds ?? r.message);
        return;
      }
      const queued = r.data.results.filter((x) => x.status === "queued").length;
      const dup = r.data.results.length - queued;
      const parts = [queued ? `${queued} envio(s) na fila com prioridade` : "", dup ? `${dup} já estava(m) na fila` : ""].filter(Boolean);
      setMessage({ ok: true, text: `${parts.join("; ")}. O worker envia 1 por canal, respeitando o intervalo de 60 s.` });
    });
  }

  const repeatByGroup = new Map(preview?.repeats.map((r) => [r.groupId, r.daysAgo]));
  const repeatedGroups = groups.filter((g) => picked.includes(g.id) && repeatByGroup.has(g.id));

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <div className="grid content-start gap-6">
        <Card title="1. Encontre o produto" description="Busque por palavra-chave ou cole o link do produto na Shopee.">
          <form onSubmit={search} role="search" aria-label="Buscar produto" className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <Field label="Palavra-chave ou link" htmlFor={searchId} error={qError} hint="Ex.: fone bluetooth, ou https://shopee.com.br/…">
              <Input id={searchId} value={q} onChange={(e) => setQ(e.target.value)} placeholder="fone bluetooth" autoComplete="off" aria-describedby={`${searchId}-msg`} aria-invalid={qError ? true : undefined} />
            </Field>
            <Button type="submit" loading={searching} icon={<IconSearch width={18} height={18} />}>Buscar</Button>
          </form>

          <div className="mt-5" aria-live="polite">
            {offers && offers.length === 0 && (
              <EmptyState icon={<IconSearch />} title="Nada encontrado">
                Tente outra palavra-chave ou cole o link do produto. Só aceitamos links https da Shopee Brasil.
              </EmptyState>
            )}
            {offers && offers.length > 0 && (
              <ul className="grid gap-2" aria-label="Resultados">
                {offers.map((o) => {
                  const on = selected?.itemId === o.itemId;
                  return (
                    <li key={o.itemId}>
                      <button
                        type="button"
                        onClick={() => choose(o)}
                        aria-pressed={on}
                        className={`flex min-h-14 w-full items-center gap-3 rounded-control border p-3 text-left transition-colors duration-150 ${on ? "border-brand-600 bg-brand-50" : "border-line-strong hover:border-ink-3 hover:bg-sunken"}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={imageOf(o)} alt="" width={44} height={44} className="size-11 shrink-0 rounded-control bg-sunken object-cover" />
                        <span className="min-w-0 flex-1">
                          <span className="line-clamp-2 text-sm font-semibold text-ink">{o.title}</span>
                          <span className="mt-0.5 block text-sm text-ink-2">
                            {formatBRL(o.price)}
                            {o.discountPct > 0 && <> · −{o.discountPct}%</>} · comissão {o.commissionRate}% · {formatInt(o.sales)} vendidos
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Card>

        <Card title="2. Escolha os grupos" description="Só grupos ativos recebem. Cada envio respeita 1 por canal, 60 s e o teto diário.">
          {groups.length === 0 ? (
            <EmptyState
              icon={<IconSend />}
              title="Nenhum grupo conectado"
              action={showConexoes ? <Button href="/conexoes#telegram" variant="secondary">Ir para Conexões</Button> : undefined}
            >
              {showConexoes
                ? "Conecte o bot do Telegram e ative ao menos um grupo para mandar ofertas."
                : "Os destinos agora são a pasta outbox; o envio por WhatsApp vem depois."}
            </EmptyState>
          ) : (
            <fieldset className="grid gap-2 sm:grid-cols-2">
              <legend className="sr-only">Grupos de destino</legend>
              {groups.map((g) => (
                <div key={g.id}>
                  <Chip label={g.active ? g.name : `${g.name} (inativo)`} checked={picked.includes(g.id)} disabled={!g.active} onChange={() => toggle(g.id)} />
                </div>
              ))}
            </fieldset>
          )}
          {repeatedGroups.length > 0 && (
            <ul className="mt-4 grid gap-1.5" aria-label="Avisos de repetição">
              {repeatedGroups.map((g) => (
                <li key={g.id} className="flex items-start gap-2 rounded-control bg-sun-50 px-3 py-2 text-sm text-sun-ink">
                  <IconAlert width={16} height={16} className="mt-0.5 shrink-0" />
                  <span>
                    Esta oferta já foi enviada em <strong>{g.name}</strong> há {repeatByGroup.get(g.id)} dia(s). Vai ser enviada de novo.
                  </span>
                </li>
              ))}
            </ul>
          )}
          {groups.length > 0 && activeGroups.length === 0 && (
            showConexoes ? (
              <p className="mt-3 text-sm text-ink-2">Nenhum grupo ativo. <Link href="/conexoes#telegram" className="font-semibold text-brand-700 underline">Ative um em Conexões</Link>.</p>
            ) : (
              <p className="mt-3 text-sm text-ink-2">Nenhum grupo ativo. Os destinos agora são a pasta outbox; o envio por WhatsApp vem depois.</p>
            )
          )}
        </Card>
      </div>

      <div className="grid content-start gap-6">
        <Card title="3. Prévia e envio">
          {!selected ? (
            <p className="text-sm text-ink-2">Escolha um produto para ver o criativo e o link curto.</p>
          ) : (
            <div className="grid gap-4">
              <CreativePreview
                title={selected.title}
                imageUrl={imageOf(selected)}
                priceCurrent={selected.price}
                priceOld={selected.oldPrice}
                discountPct={selected.discountPct}
                affiliateHandle={affiliateHandle}
              />
              <div>
                <p className="text-sm font-semibold text-ink">Link curto</p>
                <p className="break-all text-sm text-ink-2" aria-busy={previewing}>
                  {previewing ? "Gerando…" : preview ? preview.shortLink : "Indisponível agora."}
                </p>
              </div>
              <Button onClick={send} loading={sending} disabled={picked.length === 0 || !preview} icon={<IconSend width={18} height={18} />}>
                {picked.length > 1 ? `Mandar agora para ${picked.length} grupos` : "Mandar agora"}
              </Button>
              {picked.length === 0 && <p className="text-sm text-ink-2">Escolha ao menos um grupo para enviar.</p>}
            </div>
          )}
          {message && (
            <p role={message.ok ? "status" : "alert"} className={`mt-4 flex items-start gap-2 text-sm font-medium ${message.ok ? "text-ok" : "text-err"}`}>
              {message.ok ? <IconCheck width={18} height={18} /> : <IconAlert width={18} height={18} />}
              <span>
                {message.text}
                {message.ok && <> <Link href="/envios" className="underline">Acompanhar em Envios</Link>.</>}
              </span>
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
