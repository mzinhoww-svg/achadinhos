import { isIP } from "node:net";

export type ImageRejectCode = "protocolo" | "host" | "http" | "tamanho" | "tipo" | "timeout" | "rede";

export class ImageRejectedError extends Error {
  constructor(readonly code: ImageRejectCode) {
    super(`imagem rejeitada: ${code}`);
    this.name = "ImageRejectedError";
  }
}

export interface DownloadOptions {
  allowedHosts: string[];
  maxBytes: number;
  /** Tempo total: conexão + cabeçalhos + leitura do corpo. */
  timeoutMs: number;
  fetch?: typeof fetch;
}

function sniffMime(b: Uint8Array): string | undefined {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return undefined;
}

/** Decisão 002 C1: https, host na allowlist, sem IP literal, sem redirect, limite de bytes, timeout total, magic bytes. */
export async function downloadProductImage(
  rawUrl: string,
  opts: DownloadOptions,
): Promise<{ bytes: Uint8Array; mime: string }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ImageRejectedError("protocolo");
  }
  if (url.protocol !== "https:") throw new ImageRejectedError("protocolo");
  const host = url.hostname.toLowerCase();
  if (isIP(host) !== 0 || host.startsWith("[")) throw new ImageRejectedError("host");
  if (!opts.allowedHosts.some((h) => host === h || host.endsWith(`.${h}`))) throw new ImageRejectedError("host");

  const controller = new AbortController();
  let timer!: ReturnType<typeof setTimeout>;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ImageRejectedError("timeout"));
    }, opts.timeoutMs);
  });
  const doFetch = opts.fetch ?? fetch;

  const work = (async () => {
    let res: Response;
    try {
      res = await doFetch(url.toString(), { signal: controller.signal, redirect: "error" });
    } catch {
      throw new ImageRejectedError(controller.signal.aborted ? "timeout" : "rede");
    }
    if (!res.ok) throw new ImageRejectedError("http");
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > opts.maxBytes) throw new ImageRejectedError("tamanho");
    if (!res.body) throw new ImageRejectedError("rede");
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > opts.maxBytes) {
          void reader.cancel().catch(() => {});
          throw new ImageRejectedError("tamanho");
        }
        chunks.push(value);
      }
    } catch (e) {
      if (e instanceof ImageRejectedError) throw e;
      throw new ImageRejectedError(controller.signal.aborted ? "timeout" : "rede");
    }
    const bytes = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) (bytes.set(c, off), (off += c.length));
    const mime = sniffMime(bytes);
    if (!mime) throw new ImageRejectedError("tipo");
    return { bytes, mime };
  })();

  try {
    return await Promise.race([work, expired]);
  } finally {
    clearTimeout(timer);
    work.catch(() => {});
  }
}
