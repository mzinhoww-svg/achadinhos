import "server-only";
import type { DocBiblia, Evento, Proposta, ResumoDocBiblia } from "@achadinhos/shared";
import { exigirSessao } from "./auth";
import { env } from "./env";

/** Cliente do worker, só no servidor: o SERVICE_TOKEN nunca vai para o navegador. */
export class ErroWorker extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function configWorker() {
  const url = env("WORKER_URL");
  const token = env("SERVICE_TOKEN");
  if (!url || !token) throw new ErroWorker("WORKER_URL ou SERVICE_TOKEN não configurados no painel.", 500);
  return { url: url.replace(/\/+$/, ""), token };
}

/**
 * Toda chamada exige a sessão do admin (o login é a exceção). No App Router, a página roda em paralelo
 * com o layout que confere a sessão; sem esta checagem, uma visita sem login chegaria a consultar o worker.
 */
async function chamar<T>(caminho: string, init: RequestInit = {}, semSessao = false): Promise<T> {
  if (!semSessao) await exigirSessao();
  const { url, token } = configWorker();
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

export interface EstadoPausa {
  pausado: boolean;
  motivo: string | null;
  por: string | null;
  em: string | null;
}

export interface Renderizacao {
  chave: string;
  produto: { id: number; nome: string; url: string; idExterno: string };
  ofertaId: number | null;
  origemPreco: "oferta" | "previa";
  fotoOriginalUrl: string;
  mascaraUrl: string | null;
  confianca: number | null;
  fallback: boolean;
  motivoFallback: string | null;
  ampliada: boolean;
  template: string;
  preco: number | null;
  precoAntigo: number | null;
  descontoPct: number | null;
  criadoEm: string;
  pecas: { id: number; formato: string; url: string | null }[];
}

export const worker = {
  /** Leitura genérica (sessão obrigatória). */
  get: <T>(caminho: string) => chamar<T>(caminho),
  /** Escrita genérica (sessão obrigatória). */
  post: <T>(caminho: string, corpo: unknown = {}) =>
    chamar<T>(caminho, { method: "POST", body: JSON.stringify(corpo) }),
  login: (email: string, senha: string) =>
    chamar<{ admin: { id: number; email: string; nome: string } }>(
      "/auth/login",
      {
        method: "POST",
        body: JSON.stringify({ email, senha }),
      },
      true,
    ),
  listarBiblia: () => chamar<{ documentos: ResumoDocBiblia[] }>("/biblia"),
  lerDoc: (slug: string, versao?: number) =>
    chamar<DocBiblia>(`/biblia/${encodeURIComponent(slug)}${versao ? `?versao=${versao}` : ""}`),
  versoes: (slug: string) =>
    chamar<{ versoes: Omit<DocBiblia, "conteudo">[] }>(`/biblia/${encodeURIComponent(slug)}/versoes`),
  listarPropostas: (status?: Proposta["status"]) =>
    chamar<{ propostas: Proposta[] }>(`/propostas${status ? `?status=${status}` : ""}`),
  decidirProposta: (id: number, decisao: "aprovada" | "rejeitada", decididoPor: string) =>
    chamar<{ proposta: Proposta; doc: DocBiblia | null }>(`/propostas/${id}/decidir`, {
      method: "POST",
      body: JSON.stringify({ decisao, decididoPor }),
    }),
  listarEventos: (limite = 50) => chamar<{ eventos: Evento[] }>(`/eventos?limite=${limite}`),
  listarImagens: (limite = 30) =>
    chamar<{ armazenamento: string; renderizacoes: Renderizacao[] }>(`/imagens?limite=${limite}`),
  gerarLoteArte: (corpo: { limite: number; forcarFallbackEm: number; nichoId?: number }) =>
    chamar<{ pedidos: number }>("/imagem/lote", { method: "POST", body: JSON.stringify(corpo) }),
  pausa: () => chamar<EstadoPausa>("/pausa"),
  definirPausa: (pausado: boolean, motivo: string, autor: string) =>
    chamar<EstadoPausa>("/pausa", { method: "POST", body: JSON.stringify({ pausado, motivo, autor }) }),
  /** Link curto: público (sem sessão), chamado pela rota /r/:codigo. */
  clique: (codigo: string, ipHash: string | null, userAgent: string | null) =>
    chamar<{ destino: string }>(
      `/links/${encodeURIComponent(codigo)}/clique`,
      { method: "POST", body: JSON.stringify({ ipHash, userAgent }) },
      true,
    ),
  trocarSenha: (email: string, senhaAtual: string, senhaNova: string) =>
    chamar<{ ok: true }>("/auth/senha", {
      method: "POST",
      body: JSON.stringify({ email, senhaAtual, senhaNova }),
    }),
};
