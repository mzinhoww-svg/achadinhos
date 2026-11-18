import "server-only";
import type { DocBiblia, ResumoDocBiblia } from "@achadinhos/shared";

/** Cliente do worker, só no servidor: o SERVICE_TOKEN nunca vai para o navegador. */
export class ErroWorker extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function config() {
  const url = process.env.WORKER_URL;
  const token = process.env.SERVICE_TOKEN;
  if (!url || !token) throw new ErroWorker("WORKER_URL ou SERVICE_TOKEN não configurados no painel.", 500);
  return { url: url.replace(/\/+$/, ""), token };
}

async function chamar<T>(caminho: string, init: RequestInit = {}): Promise<T> {
  const { url, token } = config();
  let res: Response;
  try {
    res = await fetch(`${url}${caminho}`, {
      ...init,
      cache: "no-store",
      headers: { "content-type": "application/json", "x-service-token": token, ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ErroWorker("O worker não respondeu. Veja se a app worker está no ar na Vertra.", 503);
  }
  const corpo = (await res.json().catch(() => null)) as (T & { mensagem?: string }) | null;
  if (!res.ok) throw new ErroWorker(corpo?.mensagem ?? `Worker respondeu HTTP ${res.status}.`, res.status);
  return corpo as T;
}

export const worker = {
  login: (email: string, senha: string) =>
    chamar<{ admin: { id: number; email: string; nome: string } }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, senha }),
    }),
  listarBiblia: () => chamar<{ documentos: ResumoDocBiblia[] }>("/biblia"),
  lerDoc: (slug: string, versao?: number) =>
    chamar<DocBiblia>(`/biblia/${encodeURIComponent(slug)}${versao ? `?versao=${versao}` : ""}`),
  versoes: (slug: string) =>
    chamar<{ versoes: Omit<DocBiblia, "conteudo">[] }>(`/biblia/${encodeURIComponent(slug)}/versoes`),
};
