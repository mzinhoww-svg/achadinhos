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
  /** Ofertas recebidas na página: 0 quando a falha, ou quando a página veio vazia. */
  contagem: number;
};

/** Só o necessário da consulta: facilita dublê de teste e mantém a sonda única. */
export type OfferLiveCheckClient = Pick<ShopeeClient, "productOfferV2">;

export const LIVE_CHECK_OK_CODE = "OK";
export const UNKNOWN_ERROR_CODE = "ERRO_DESCONHECIDO";
export const ERROR_WITHOUT_CODE = "ERRO";
/** Código presente mas fora de formato seguro: nunca vai ao terminal como veio. */
export const INVALID_CODE = "CODIGO_INVALIDO";

/** Só isto pode ser impresso: nada de quebra de linha, espaço, vírgula ou tamanho livre. */
const SAFE_CODE = /^[A-Za-z0-9_-]{1,32}$/;

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
 * cliente já derivou — **validado antes de sair**: `extensions.code` é resposta
 * da Shopee, e resposta é dado, não texto de terminal (`live-check.test.ts`
 * injeta `\n`, texto de assinatura e 5000 caracteres). Sem código, `ERRO`; com
 * código fora de `^[A-Za-z0-9_-]{1,32}$`, `CODIGO_INVALIDO`. A mensagem do erro
 * nunca entra no resultado.
 */
export function liveCheckErrorCode(error: unknown): string {
  if (error instanceof ShopeeHttpError) return `HTTP_${error.status}`;
  if (error instanceof ShopeeError) return safeCode(error.code);
  return UNKNOWN_ERROR_CODE;
}

function safeCode(code: string | undefined): string {
  if (code === undefined || code === "") return ERROR_WITHOUT_CODE;
  return SAFE_CODE.test(code) ? code : INVALID_CODE;
}

/** Três linhas, nessa ordem, e nada mais. */
export function formatLiveCheck(result: LiveCheckResult): string {
  return [
    `resultado=${result.resultado}`,
    `codigo=${result.codigo}`,
    `contagem=${result.contagem}`,
  ].join("\n");
}
