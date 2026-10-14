/** Formata centavos-agnóstico: 99.9 -> "99,90"; 1234.5 -> "1.234,50". Sem Intl (ICU varia por runtime). */
export function formatBRL(value: number): string {
  const cents = Math.round(value * 100);
  const int = Math.floor(cents / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const dec = (cents % 100).toString().padStart(2, "0");
  return `R$ ${int},${dec}`;
}

export function discountPct(current: number, old: number): number {
  if (old <= 0 || current >= old) return 0;
  return Math.round((1 - current / old) * 100);
}
