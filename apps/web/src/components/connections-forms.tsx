"use client";

import { useActionState, useTransition } from "react";
import { saveShopeeAction, saveTelegramAction, setGroupActiveAction, type FormState } from "@/app/conexoes/actions";
import { Button } from "@/components/ui/button";
import { Field, Input, Switch } from "@/components/ui/form";
import { IconLock } from "@/components/ui/icons";
import type { PublicShopee } from "@/server/connections";

function Feedback({ state }: { state: FormState }) {
  if (!state) return null;
  return state.ok ? (
    <p role="status" className="text-sm font-medium text-ok">{state.data.summary}</p>
  ) : (
    <p role="alert" className="text-sm font-medium text-err">{state.message}</p>
  );
}
const fieldError = (state: FormState, key: string) => (state && !state.ok ? state.fieldErrors?.[key] : undefined);

export function ShopeeForm({ current }: { current: PublicShopee | null }) {
  const [state, action, pending] = useActionState(saveShopeeAction, null);
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2" aria-label="Credenciais da Shopee" autoComplete="off">
      <Field label="App ID" htmlFor="app-id" error={fieldError(state, "appId")} hint={current ? "Informe de novo ao substituir a credencial." : "Número do aplicativo no painel de afiliados."}>
        <Input id="app-id" name="appId" inputMode="numeric" autoComplete="off" placeholder="Ex.: 18350000000" defaultValue={current?.appId ?? ""} aria-describedby="app-id-msg" />
      </Field>
      <Field
        label={current ? "Novo Secret" : "Secret"}
        htmlFor="secret"
        error={fieldError(state, "secret")}
        hint={
          <span className="inline-flex items-center gap-1.5">
            <IconLock width={14} height={14} />
            {current ? `Guardado no cofre (termina em ${current.secretLast4}). Digite um novo valor apenas para substituir.` : "Vai direto para o cofre e só o worker lê."}
          </span>
        }
      >
        <Input id="secret" name="secret" type="password" autoComplete="new-password" placeholder={current ? "••••••••••••••••" : "Cole o Secret"} aria-describedby="secret-msg" />
      </Field>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Button type="submit" loading={pending}>{current ? "Substituir credencial" : "Validar e salvar"}</Button>
        <Feedback state={state} />
      </div>
    </form>
  );
}

export function TelegramForm({ connected }: { connected: boolean }) {
  const [state, action, pending] = useActionState(saveTelegramAction, null);
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end" aria-label="Token do bot do Telegram" autoComplete="off">
      <Field label={connected ? "Novo token do bot" : "Token do bot"} htmlFor="bot-token" error={fieldError(state, "token")} hint="Guardado no cofre; não é exibido depois de salvo.">
        <Input id="bot-token" name="token" type="password" autoComplete="new-password" placeholder={connected ? "••••••••••••••••" : "Cole o token do bot"} aria-describedby="bot-token-msg" />
      </Field>
      <Button type="submit" variant="secondary" loading={pending}>{connected ? "Atualizar bot" : "Validar bot"}</Button>
      <div className="sm:col-span-2"><Feedback state={state} /></div>
    </form>
  );
}

export function GroupSwitch({ groupId, name, active }: { groupId: string; name: string; active: boolean }) {
  const [pending, start] = useTransition();
  return (
    <Switch
      label={active ? "Ativo" : "Inativo"}
      aria-label={`Ativar ${name}`}
      checked={active}
      disabled={pending}
      onChange={(e) => start(async () => { await setGroupActiveAction(groupId, e.target.checked); })}
    />
  );
}
