/**
 * T8-A — flags do painel.
 *
 * O painel passa a usar só o container em memória (§2 do plano): as telas de Conexões/Telegram
 * são dormentes e ficam atrás de uma flag. As rotas são preservadas; sem a flag, `/conexoes`
 * responde 404 e o item some do menu.
 */
export function conexoesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ACHADINHOS_CONEXOES === "1";
}
