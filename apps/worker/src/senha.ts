import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (s: string, salt: Buffer, len: number, o: object) => Promise<Buffer>;
const N = 16384;
const R = 8;
const P = 1;

export async function gerarHashSenha(senha: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(senha.normalize("NFKC"), salt, 32, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

/** Mesmo custo quando o hash é nulo, para o tempo não revelar se o e-mail existe. */
export async function conferirSenha(senha: string, armazenado: string | null): Promise<boolean> {
  const m = armazenado ? /^scrypt\$(\d+)\$(\d+)\$(\d+)\$([^$]+)\$([^$]+)$/.exec(armazenado) : null;
  const salt = m?.[4] ? Buffer.from(m[4], "base64") : randomBytes(16);
  const esperado = m?.[5] ? Buffer.from(m[5], "base64") : randomBytes(32);
  const n = m ? Number(m[1]) : N;
  const r = m ? Number(m[2]) : R;
  const p = m ? Number(m[3]) : P;
  const obtido = await scrypt(senha.normalize("NFKC"), salt, esperado.length, {
    N: n,
    r,
    p,
    maxmem: 256 * n * r,
  });
  return m !== null && obtido.length === esperado.length && timingSafeEqual(obtido, esperado);
}
