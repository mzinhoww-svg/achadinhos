import { type Db, tabelas as t } from "@achadinhos/db";
import { eq } from "drizzle-orm";

/** T3.7: onde as peças ficam. O Blob da Vertra é o principal; o banco é a reserva até a chave existir. */
export interface Armazenamento {
  readonly nome: "vertra-blob" | "banco";
  /** Grava e devolve a URL pública. `baseUrl` só é usado pelo armazenamento no banco. */
  gravar(caminho: string, dados: Buffer, tipo: string, baseUrl: string): Promise<string>;
}

/** Procura a URL pública na resposta do Blob, sem depender do nome exato do campo. */
export function acharUrlPublica(corpo: unknown): string | null {
  const urls: { chave: string; valor: string }[] = [];
  const visitar = (v: unknown, chave: string, prof: number) => {
    if (prof > 4 || v == null) return;
    if (typeof v === "string") {
      if (/^https:\/\//.test(v)) urls.push({ chave: chave.toLowerCase(), valor: v });
      return;
    }
    if (typeof v === "object") for (const [k, x] of Object.entries(v)) visitar(x, k, prof + 1);
  };
  visitar(corpo, "", 0);
  const nota = (c: string) => (c.includes("public") ? 0 : c === "url" ? 1 : c.includes("url") ? 2 : 3);
  urls.sort((a, b) => nota(a.chave) - nota(b.chave));
  const melhor = urls[0];
  return melhor && nota(melhor.chave) < 3 ? melhor.valor : null;
}

export class VertraBlob implements Armazenamento {
  readonly nome = "vertra-blob" as const;
  private ultimoEnvio = 0;
  constructor(
    private readonly chave: string,
    private readonly baseUrl: string,
    private readonly prefixo: string,
    private readonly f: typeof fetch = fetch,
  ) {}

  async gravar(caminho: string, dados: Buffer, tipo: string): Promise<string> {
    // Plano da Vertra: 1 upload por segundo.
    const espera = this.ultimoEnvio + 1100 - Date.now();
    if (espera > 0) await new Promise((r) => setTimeout(r, espera));
    this.ultimoEnvio = Date.now();
    const path = `${this.prefixo}/${caminho}`;
    const url = new URL(`${this.baseUrl.replace(/\/$/, "")}/objects`);
    url.searchParams.set("path", path);
    url.searchParams.set("visibility", "public");
    url.searchParams.set("overwrite", "true");
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(dados)], { type: tipo }),
      caminho.split("/").pop() ?? "peca",
    );
    const res = await this.f(url, {
      method: "POST",
      headers: { authorization: `Bearer ${this.chave}` },
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
    const texto = await res.text();
    if (!res.ok) throw new Error(`Blob da Vertra respondeu HTTP ${res.status}: ${texto.slice(0, 200)}`);
    let corpo: unknown = null;
    try {
      corpo = JSON.parse(texto);
    } catch {
      /* resposta sem JSON */
    }
    const publica = acharUrlPublica(corpo);
    if (!publica) throw new Error("o Blob da Vertra não devolveu a URL pública do arquivo");
    return publica;
  }
}

export class ArmazenamentoBanco implements Armazenamento {
  readonly nome = "banco" as const;
  constructor(private readonly db: Db) {}

  async gravar(caminho: string, dados: Buffer, tipo: string, baseUrl: string): Promise<string> {
    await this.db
      .insert(t.arquivos)
      .values({ caminho, tipo, dadosB64: dados.toString("base64"), tamanho: dados.length })
      .onConflictDoUpdate({
        target: t.arquivos.caminho,
        set: { tipo, dadosB64: dados.toString("base64"), tamanho: dados.length },
      });
    return `${baseUrl.replace(/\/$/, "")}/arquivos/${caminho}`;
  }
}

export async function lerArquivo(db: Db, caminho: string) {
  const [a] = await db.select().from(t.arquivos).where(eq(t.arquivos.caminho, caminho));
  return a ? { tipo: a.tipo, dados: Buffer.from(a.dadosB64, "base64") } : null;
}
