/** Lê uma variável; vazia ou "PENDENTE" (marcador das variáveis à espera do valor na Vertra) conta como ausente. */
export function env(nome: string): string | undefined {
  const v = process.env[nome];
  return v && v !== "PENDENTE" ? v : undefined;
}
