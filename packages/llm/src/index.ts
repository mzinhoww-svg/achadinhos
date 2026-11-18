/**
 * Cliente no padrão da API da OpenAI (POST {base}/chat/completions). OpenRouter por padrão.
 * O modelo de cada tarefa vem da bíblia (AGENTES.md); quando o principal falha, tenta o reserva.
 * Toda chamada é registrada (capacidade 7 do contrato) pelo callback `registrar`, com chave idempotente.
 */

export interface Mensagem {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ModelosTarefa {
  principal: string;
  reserva?: string;
}

export interface ChamadaRegistrada {
  chaveIdempotente: string;
  servico: "llm";
  agente: string | null;
  modelo: string;
  tokensEntrada: number | null;
  tokensSaida: number | null;
  custoUsd: number | null;
  sucesso: boolean;
  erro: string | null;
}

export interface ConfigLlm {
  /** Ex.: https://openrouter.ai/api/v1 */
  baseUrl?: string;
  apiKey: string;
  /** Modelos por tarefa, lidos da bíblia. */
  modelos: Record<string, ModelosTarefa>;
  /** Reserva geral, quando a tarefa não define um. */
  modeloReservaPadrao?: string;
  timeoutMs?: number;
  registrar?: (c: ChamadaRegistrada) => Promise<void> | void;
  fetch?: typeof fetch;
  /** Cabeçalhos opcionais do OpenRouter para identificar o app. */
  titulo?: string;
}

export interface PedidoConversa {
  tarefa: string;
  mensagens: Mensagem[];
  chaveIdempotente: string;
  agente?: string;
  temperatura?: number;
  maxTokens?: number;
}

export interface RespostaConversa {
  texto: string;
  modelo: string;
  usouReserva: boolean;
  tokensEntrada: number | null;
  tokensSaida: number | null;
  custoUsd: number | null;
}

export class ErroLlm extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly recuperavel: boolean,
  ) {
    super(message);
    this.name = "ErroLlm";
  }
}

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export function criarClienteLlm(config: ConfigLlm) {
  const baseUrl = (config.baseUrl ?? OPENROUTER_BASE_URL).replace(/\/+$/, "");
  const f = config.fetch ?? fetch;
  const timeoutMs = config.timeoutMs ?? 60_000;

  async function chamar(modelo: string, p: PedidoConversa): Promise<RespostaConversa> {
    const controle = new AbortController();
    const timer = setTimeout(() => controle.abort(), timeoutMs);
    try {
      const res = await f(`${baseUrl}/chat/completions`, {
        method: "POST",
        signal: controle.signal,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.apiKey}`,
          ...(config.titulo ? { "x-title": config.titulo } : {}),
        },
        body: JSON.stringify({
          model: modelo,
          messages: p.mensagens,
          ...(p.temperatura !== undefined ? { temperature: p.temperatura } : {}),
          ...(p.maxTokens !== undefined ? { max_tokens: p.maxTokens } : {}),
          // OpenRouter devolve o custo em usage.cost quando pedido; outros provedores ignoram.
          usage: { include: true },
        }),
      });
      const corpo = (await res.json().catch(() => null)) as {
        choices?: { message?: { content?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
        error?: { message?: string };
      } | null;
      if (!res.ok) {
        const msg = corpo?.error?.message ?? `HTTP ${res.status}`;
        throw new ErroLlm(msg, res.status, res.status === 429 || res.status >= 500);
      }
      const texto = corpo?.choices?.[0]?.message?.content;
      if (typeof texto !== "string") throw new ErroLlm("resposta sem texto", res.status, true);
      return {
        texto,
        modelo,
        usouReserva: false,
        tokensEntrada: corpo?.usage?.prompt_tokens ?? null,
        tokensSaida: corpo?.usage?.completion_tokens ?? null,
        custoUsd: corpo?.usage?.cost ?? null,
      };
    } catch (e) {
      if (e instanceof ErroLlm) throw e;
      const abortado = e instanceof Error && e.name === "AbortError";
      throw new ErroLlm(abortado ? "tempo esgotado" : String(e), null, true);
    } finally {
      clearTimeout(timer);
    }
  }

  async function registrar(
    p: PedidoConversa,
    sufixo: string,
    modelo: string,
    r: RespostaConversa | null,
    erro: unknown,
  ) {
    await config.registrar?.({
      chaveIdempotente: `${p.chaveIdempotente}:${sufixo}`,
      servico: "llm",
      agente: p.agente ?? null,
      modelo,
      tokensEntrada: r?.tokensEntrada ?? null,
      tokensSaida: r?.tokensSaida ?? null,
      custoUsd: r?.custoUsd ?? null,
      sucesso: r !== null,
      erro: erro ? String(erro instanceof Error ? erro.message : erro) : null,
    });
  }

  return {
    async conversar(p: PedidoConversa): Promise<RespostaConversa> {
      const modelos = config.modelos[p.tarefa];
      if (!modelos) throw new ErroLlm(`tarefa sem modelo definido na bíblia: ${p.tarefa}`, null, false);
      try {
        const r = await chamar(modelos.principal, p);
        await registrar(p, "principal", modelos.principal, r, null);
        return r;
      } catch (e) {
        await registrar(p, "principal", modelos.principal, null, e);
        const reserva = modelos.reserva ?? config.modeloReservaPadrao;
        if (!reserva || reserva === modelos.principal || (e instanceof ErroLlm && !e.recuperavel)) throw e;
        try {
          const r = { ...(await chamar(reserva, p)), usouReserva: true };
          await registrar(p, "reserva", reserva, r, null);
          return r;
        } catch (e2) {
          await registrar(p, "reserva", reserva, null, e2);
          throw e2;
        }
      }
    },
  };
}
