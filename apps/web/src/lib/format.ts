import { formatBRL } from "@achadinhos/creative";

export { formatBRL };

/** Datas ficam em UTC no banco; a UI converte para o fuso da conta (America/Cuiaba). */
export const ACCOUNT_TZ = "America/Cuiaba";

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: ACCOUNT_TZ,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function formatTime(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: ACCOUNT_TZ, hour: "2-digit", minute: "2-digit" }).format(
    new Date(iso),
  );
}

export function formatInt(n: number): string {
  return new Intl.NumberFormat("pt-BR").format(n);
}
