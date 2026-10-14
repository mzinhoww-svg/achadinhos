/** Remove de qualquer texto os segredos conhecidos e o formato de token do Telegram (`123456:ABC...`). */
export function sanitizeText(text: string, secrets: string[] = []): string {
  let out = text;
  for (const s of secrets) if (s.length >= 4) out = out.split(s).join("[redigido]");
  return out
    .replace(/\bbot\d{3,}:[A-Za-z0-9_-]{10,}/g, "bot[redigido]")
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{20,}\b/g, "[redigido]");
}
