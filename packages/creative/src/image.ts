import { lookup } from "node:dns/promises";

export type CreativeErrorCode =
  | "scheme"
  | "host_not_allowed"
  | "blocked_address"
  | "too_many_redirects"
  | "http_status"
  | "too_large"
  | "too_many_pixels"
  | "bad_type"
  | "timeout"
  | "network"
  | "image_missing"
  | "invalid_input"
  | "render";

/** Erro tipado e seguro para log/`failed.reason`: a mensagem nunca carrega URL, query ou corpo. */
export class CreativeError extends Error {
  constructor(
    readonly code: CreativeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CreativeError";
  }
}

export type ImageMime = "image/jpeg" | "image/png" | "image/webp";
export interface ImageInfo {
  mime: ImageMime;
  width: number;
  height: number;
}
export interface FetchedImage extends ImageInfo {
  bytes: Uint8Array;
}

/** CDN da Shopee (sufixos). Confirmar contra respostas reais assim que houver credencial. */
export const DEFAULT_ALLOWED_HOSTS = ["susercontent.com", "shopee.com.br", "shopee.com", "shopeemobile.com"];

export interface FetchImageOptions {
  fetch?: typeof fetch;
  resolveHost?: (host: string) => Promise<string[]>;
  allowedHosts?: string[];
  maxBytes?: number;
  timeoutMs?: number;
  maxPixels?: number;
  maxSide?: number;
  maxRedirects?: number;
}

const defaultResolve = async (host: string) => (await lookup(host, { all: true })).map((a) => a.address);

export function isBlockedAddress(addr: string): boolean {
  let ip = addr.trim().toLowerCase().replace(/^\[|\]$/g, "");
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped) ip = mapped[1]!;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if ([a, b, Number(v4[3]), Number(v4[4])].some((n) => n > 255)) return true;
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  if (ip.includes(":")) {
    if (ip === "::" || ip === "::1") return true;
    const first = parseInt(ip.split(":")[0] || "0", 16);
    if (Number.isNaN(first)) return true;
    return (first >= 0xfc00 && first <= 0xfdff) || (first >= 0xfe80 && first <= 0xfebf) || first >= 0xff00;
  }
  return true; // não é IP reconhecível: falha fechada
}

export function imageInfo(b: Uint8Array): ImageInfo | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { mime: "image/png", width: dv.getUint32(16), height: dv.getUint32(20) };
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    let o = 2;
    while (o + 9 < b.length) {
      if (b[o] !== 0xff) return null;
      const marker = b[o + 1]!;
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { o += 2; continue; }
      const len = dv.getUint16(o + 2);
      const sof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (sof) return { mime: "image/jpeg", height: dv.getUint16(o + 5), width: dv.getUint16(o + 7) };
      o += 2 + len;
    }
    return null;
  }
  if (b.length >= 30 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") {
    const kind = ascii(b, 12, 4);
    if (kind === "VP8X") {
      return { mime: "image/webp", width: 1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16)), height: 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16)) };
    }
    if (kind === "VP8L" && b[20] === 0x2f) {
      const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
      return { mime: "image/webp", width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
    }
    if (kind === "VP8 " && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
      return { mime: "image/webp", width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff };
    }
  }
  return null;
}
const ascii = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));

function checkUrl(raw: string, allowed: string[]): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new CreativeError("scheme", "URL da imagem inválida.");
  }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) {
    throw new CreativeError("scheme", "Só https na porta padrão, sem credenciais.");
  }
  const host = u.hostname.toLowerCase();
  if (!allowed.some((s) => host === s || host.endsWith(`.${s}`))) {
    throw new CreativeError("host_not_allowed", "Host da imagem fora da allowlist do CDN.");
  }
  return u;
}

/** Baixa a foto do produto: https + allowlist + sem IP interno + limites de bytes, pixels e tempo TOTAL (inclui o corpo). */
export async function fetchProductImage(url: string, opts: FetchImageOptions = {}): Promise<FetchedImage> {
  const f = opts.fetch ?? globalThis.fetch;
  const resolveHost = opts.resolveHost ?? defaultResolve;
  const allowed = opts.allowedHosts ?? DEFAULT_ALLOWED_HOSTS;
  const maxBytes = opts.maxBytes ?? 5 * 1024 * 1024;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const maxPixels = opts.maxPixels ?? 25_000_000;
  const maxSide = opts.maxSide ?? 8000;
  const maxRedirects = opts.maxRedirects ?? 3;
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, rej) => {
    timer = setTimeout(() => {
      ctrl.abort();
      rej(new CreativeError("timeout", "Tempo esgotado ao baixar a imagem."));
    }, timeoutMs);
  });

  const run = async (): Promise<FetchedImage> => {
    let current = checkUrl(url, allowed);
    for (let hop = 0; ; hop++) {
      const addrs = await resolveHost(current.hostname);
      if (addrs.length === 0 || addrs.some(isBlockedAddress)) {
        throw new CreativeError("blocked_address", "O host da imagem resolve para endereço interno.");
      }
      const res = await f(current.toString(), { redirect: "manual", signal: ctrl.signal, headers: { accept: "image/jpeg,image/png,image/webp" } });
      if (res.status >= 300 && res.status < 400) {
        if (hop >= maxRedirects) throw new CreativeError("too_many_redirects", "Redirecionamentos demais.");
        const loc = res.headers.get("location");
        if (!loc) throw new CreativeError("http_status", "Redirecionamento sem destino.");
        current = checkUrl(new URL(loc, current).toString(), allowed);
        continue;
      }
      if (res.status !== 200) throw new CreativeError("http_status", `A imagem respondeu HTTP ${res.status}.`);
      const declared = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
      if (!["image/jpeg", "image/png", "image/webp"].includes(declared)) throw new CreativeError("bad_type", "Tipo de conteúdo não permitido.");
      const len = Number(res.headers.get("content-length") ?? "0");
      if (len > maxBytes) throw new CreativeError("too_large", "Imagem acima do limite de tamanho.");
      const bytes = await readLimited(res, maxBytes);
      const info = imageInfo(bytes);
      if (!info || info.mime !== declared) throw new CreativeError("bad_type", "O conteúdo não é a imagem declarada.");
      if (info.width < 1 || info.height < 1 || info.width > maxSide || info.height > maxSide || info.width * info.height > maxPixels) {
        throw new CreativeError("too_many_pixels", "Imagem com dimensões acima do limite.");
      }
      return { bytes, ...info };
    }
  };

  try {
    return await Promise.race([run(), deadline]);
  } catch (e) {
    if (e instanceof CreativeError) throw e;
    if (ctrl.signal.aborted) throw new CreativeError("timeout", "Tempo esgotado ao baixar a imagem.");
    throw new CreativeError("network", "Falha de rede ao baixar a imagem.");
  } finally {
    if (timer) clearTimeout(timer);
    ctrl.abort();
  }
}

async function readLimited(res: Response, maxBytes: number): Promise<Uint8Array> {
  if (!res.body) throw new CreativeError("network", "Resposta sem corpo.");
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new CreativeError("too_large", "Imagem acima do limite de tamanho.");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}
