/**
 * Limite simples por chave (janela fixa de 1 minuto), em memória do processo do painel.
 * Serve para o /r: um mesmo IP não infla cliques nem martela o worker.
 */
const janelas = new Map<string, { n: number; fim: number }>();

export function permitir(chave: string, porMinuto = 30, agora = Date.now()): boolean {
  const j = janelas.get(chave);
  if (!j || j.fim <= agora) {
    janelas.set(chave, { n: 1, fim: agora + 60_000 });
    if (janelas.size > 50_000) for (const [k, v] of janelas) if (v.fim <= agora) janelas.delete(k);
    return true;
  }
  j.n++;
  return j.n <= porMinuto;
}
