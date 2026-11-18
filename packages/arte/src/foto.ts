import sharp from "sharp";

/** Erro da Arte, com código para o log e para o motivo do fallback. */
export class ErroArte extends Error {
  constructor(
    message: string,
    readonly codigo: string,
  ) {
    super(message);
    this.name = "ErroArte";
  }
}

const LIMITE_BYTES = 15 * 1024 * 1024;

/**
 * URL da foto oficial na maior resolução. Na Shopee, o sufixo `_tn` é a miniatura: sem ele vem a original.
 * Só https.
 */
export function urlMelhorResolucao(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new ErroArte("URL da foto inválida", "FOTO_URL");
  }
  if (u.protocol !== "https:") throw new ErroArte("a foto precisa vir por https", "FOTO_URL");
  if (/(^|\.)(susercontent\.com|shopee\.com\.br)$/.test(u.hostname)) {
    u.pathname = u.pathname.replace(/_tn$/, "");
    u.search = "";
  }
  return u.toString();
}

export interface FotoBaixada {
  buffer: Buffer;
  url: string;
  largura: number;
  altura: number;
}

/** Baixa a foto oficial (até 15 MB) e confere que é imagem de verdade. */
export async function baixarFoto(
  url: string,
  f: typeof fetch = fetch,
  timeoutMs = 20_000,
): Promise<FotoBaixada> {
  const alvo = urlMelhorResolucao(url);
  let res: Response;
  try {
    res = await f(alvo, { signal: AbortSignal.timeout(timeoutMs), redirect: "follow" });
  } catch {
    throw new ErroArte("não foi possível baixar a foto", "FOTO_REDE");
  }
  if (!res.ok) throw new ErroArte(`a foto respondeu HTTP ${res.status}`, "FOTO_HTTP");
  const tamanho = Number(res.headers.get("content-length") ?? 0);
  if (tamanho > LIMITE_BYTES) throw new ErroArte("foto grande demais", "FOTO_GRANDE");
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > LIMITE_BYTES) throw new ErroArte("foto grande demais", "FOTO_GRANDE");
  const meta = await sharp(buffer)
    .metadata()
    .catch(() => null);
  if (!meta?.width || !meta.height) throw new ErroArte("o arquivo baixado não é uma imagem", "FOTO_INVALIDA");
  return { buffer, url: alvo, largura: meta.width, altura: meta.height };
}

/**
 * T3.5: amplia só quando o menor lado tem menos de 800 px. Interpolação Lanczos (sem IA): a imagem
 * fica maior, mas o produto não ganha nem perde detalhe inventado.
 */
export async function ampliarSePreciso(
  buffer: Buffer,
  minimo = 800,
): Promise<{ buffer: Buffer; ampliada: boolean; fator: number }> {
  const meta = await sharp(buffer).metadata();
  const menor = Math.min(meta.width ?? 0, meta.height ?? 0);
  if (!menor || menor >= minimo) return { buffer, ampliada: false, fator: 1 };
  const fator = minimo / menor;
  const saida = await sharp(buffer)
    .rotate()
    .resize({
      width: Math.round((meta.width ?? 0) * fator),
      height: Math.round((meta.height ?? 0) * fator),
      kernel: "lanczos3",
    })
    .png()
    .toBuffer();
  return { buffer: saida, ampliada: true, fator: Math.round(fator * 100) / 100 };
}
