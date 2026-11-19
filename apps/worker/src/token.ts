import { createHash, timingSafeEqual } from "node:crypto";

/** Compara o X-Service-Token em tempo constante (pelo SHA-256, para igualar os tamanhos). */
export function tokenConfere(recebido: unknown, esperado: string): boolean {
  if (typeof recebido !== "string" || recebido.length === 0) return false;
  const a = createHash("sha256").update(recebido).digest();
  const b = createHash("sha256").update(esperado).digest();
  return timingSafeEqual(a, b);
}
