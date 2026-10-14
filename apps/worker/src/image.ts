import { CreativeError, fetchProductImage, type CreativeErrorCode } from "@achadinhos/creative/image";

export type ImageRejectCode =
  | "protocolo"
  | "host"
  | "endereco_interno"
  | "redirecionamento"
  | "http"
  | "tamanho"
  | "dimensoes"
  | "tipo"
  | "timeout"
  | "rede";

export class ImageRejectedError extends Error {
  constructor(readonly code: ImageRejectCode) {
    super(`imagem rejeitada: ${code}`);
    this.name = "ImageRejectedError";
  }
}

export interface DownloadOptions {
  allowedHosts: string[];
  maxBytes: number;
  /** Tempo total: DNS + conexão + cabeçalhos + leitura do corpo (todos os saltos). */
  timeoutMs: number;
  fetch?: typeof fetch;
  /** Resolução de DNS; o padrão é `dns.lookup`. Injetável para teste, nunca para pular a checagem. */
  resolveHost?: ((host: string) => Promise<string[]>) | undefined;
}

/** Código do downloader seguro do creative → código estável do worker (vira `imagem_<código>`). */
const CODES: Record<CreativeErrorCode, ImageRejectCode> = {
  scheme: "protocolo",
  host_not_allowed: "host",
  blocked_address: "endereco_interno",
  too_many_redirects: "redirecionamento",
  http_status: "http",
  too_large: "tamanho",
  too_many_pixels: "dimensoes",
  bad_type: "tipo",
  timeout: "timeout",
  network: "rede",
  image_missing: "rede",
  invalid_input: "rede",
  render: "rede",
};

/**
 * Decisão 002 C1 sobre o downloader do #23: https, allowlist, DNS/IP público checado a cada salto,
 * redirects revalidados, limites de bytes e dimensões, magic bytes e timeout TOTAL. Falha fechada:
 * qualquer erro vira ImageRejectedError com código fixo (a mensagem original nunca sai daqui).
 */
export async function downloadProductImage(
  rawUrl: string,
  opts: DownloadOptions,
): Promise<{ bytes: Uint8Array; mime: string }> {
  try {
    const image = await fetchProductImage(rawUrl, {
      allowedHosts: opts.allowedHosts,
      maxBytes: opts.maxBytes,
      timeoutMs: opts.timeoutMs,
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
      ...(opts.resolveHost ? { resolveHost: opts.resolveHost } : {}),
    });
    return { bytes: image.bytes, mime: image.mime };
  } catch (e) {
    throw new ImageRejectedError(e instanceof CreativeError ? CODES[e.code] : "rede");
  }
}
