import type { ShopeeClient } from "./client.js";
import { ShopeeError, ShopeeHttpError } from "./errors.js";

/**
 * Sonda de credencial: **uma** consulta somente-leitura (`productOfferV2`,
 * `limit: 1`), nunca em laço, com o mesmo alvo de `validateShopee`
 * (apps/worker/src/validation/validators.ts).
 *
 * O relatório é o único texto que pode sair daqui: rótulo, código e contagem.
 * Mensagem de erro, corpo da resposta, App ID, Secret e o header de assinatura
 * nunca entram no resultado (também não vazam por `JSON.stringify`).
 */
export type LiveCheckResult = {
  resultado: "sucesso" | "falha";
  /** Código do erro (`10020`, `HTTP_403`, `TIMEOUT`, …) ou `OK` no sucesso. */
  codigo: string;
  /** Ofertas recebidas na página: 1 no sucesso, 0 na falha. */
  contagem: number;
};

/** Só o necessário da consulta: facilita dublê de teste e mantém a sonda única. */
export type OfferLiveCheckClient = Pick<ShopeeClient, "productOfferV2">;

export const LIVE_CHECK_OK_CODE = "OK";
export const UNKNOWN_ERROR_CODE = "ERRO_DESCONHECIDO";
export const ERROR_WITHOUT_CODE = "ERRO";

export async function runOfferLiveCheck(
  client: OfferLiveCheckClient,
): Promise<LiveCheckResult> {
  try {
    const page = await client.productOfferV2({ limit: 1 });
    return { resultado: "sucesso", codigo: LIVE_CHECK_OK_CODE, contagem: page.nodes.length };
  } catch (error) {
    return { resultado: "falha", codigo: liveCheckErrorCode(error), contagem: 0 };
  }
}

/**
 * Status HTTP prevalece (429/5xx não são credencial ruim); senão o código que o
 * cliente já derivou. Erro fora da taxonomia vira `ERRO_DESCONHECIDO` — a
 * mensagem original fica de fora de propósito.
 */
export function liveCheckErrorCode(error: unknown): string {
  if (error instanceof ShopeeHttpError) return `HTTP_${error.status}`;
  if (error instanceof ShopeeError) return error.code ?? ERROR_WITHOUT_CODE;
  return UNKNOWN_ERROR_CODE;
}

/** Três linhas, nessa ordem, e nada mais. */
export function formatLiveCheck(result: LiveCheckResult): string {
  return [
    `resultado=${result.resultado}`,
    `codigo=${result.codigo}`,
    `contagem=${result.contagem}`,
  ].join("\n");
}
