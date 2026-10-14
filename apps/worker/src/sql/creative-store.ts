import type { Secret } from "../config.js";

export class CreativeStoreConfigError extends Error {
  constructor(what: string) {
    super(`armazenamento do criativo: configuração inválida (${what})`);
    this.name = "CreativeStoreConfigError";
  }
}

export interface SupabaseCreativeStoreOptions {
  /** https://<projeto>.supabase.co */
  url: string;
  /** service_role: só no worker (decisão 003 H2). Nunca em log. */
  serviceRoleKey: Secret;
  /** Bucket PRIVADO (decisão 002 C5). */
  bucket: string;
  fetch?: typeof fetch;
  /** Teto total por chamada HTTP. */
  timeoutMs?: number;
  signedTtlSec?: number;
}

/**
 * Persiste o PNG no bucket privado e devolve URL assinada de vida curta para o Telegram.
 * `creative_url` guarda só o caminho do objeto. Erros: texto fixo (nada do corpo/URL/chave).
 */
export class SupabaseCreativeStore {
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly ttl: number;

  constructor(private readonly o: SupabaseCreativeStoreOptions) {
    let u: URL;
    try {
      u = new URL(o.url);
    } catch {
      throw new CreativeStoreConfigError("SUPABASE_URL");
    }
    if (u.protocol !== "https:" || u.username || u.password) throw new CreativeStoreConfigError("SUPABASE_URL");
    if (o.serviceRoleKey.reveal().trim() === "") throw new CreativeStoreConfigError("SUPABASE_SERVICE_ROLE_KEY");
    if (!/^[a-z0-9][a-z0-9_-]{1,62}$/i.test(o.bucket)) throw new CreativeStoreConfigError("bucket");
    this.base = `${u.origin}/storage/v1`;
    this.fetchImpl = o.fetch ?? fetch;
    this.timeoutMs = o.timeoutMs ?? 15_000;
    this.ttl = o.signedTtlSec ?? 300;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { Authorization: `Bearer ${this.o.serviceRoleKey.reveal()}`, ...extra };
  }

  async put(png: Uint8Array, sendId: string): Promise<{ photoUrl: string; objectPath: string }> {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(sendId)) throw new Error("armazenamento do criativo: id inválido");
    const objectPath = `${sendId}.png`;
    const up = await this.fetchImpl(`${this.base}/object/${this.o.bucket}/${objectPath}`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "image/png", "x-upsert": "true" }),
      body: png as unknown as BodyInit,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!up.ok) throw new Error(`armazenamento do criativo: upload recusado (${up.status})`);
    const sg = await this.fetchImpl(`${this.base}/object/sign/${this.o.bucket}/${objectPath}`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ expiresIn: this.ttl }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!sg.ok) throw new Error(`armazenamento do criativo: assinatura recusada (${sg.status})`);
    const j = (await sg.json().catch(() => null)) as { signedURL?: unknown } | null;
    if (!j || typeof j.signedURL !== "string" || !j.signedURL.startsWith("/")) {
      throw new Error("armazenamento do criativo: resposta de assinatura inválida");
    }
    return { photoUrl: `${this.base}${j.signedURL}`, objectPath };
  }
}
