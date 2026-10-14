import {
  ShopeeConfigError,
  ShopeeHttpError,
  ShopeeSignatureError,
} from "@achadinhos/shopee";
import type { ShopeeClient } from "@achadinhos/shopee";
import {
  BotBlockedError,
  BotRemovedError,
  ChatNotFoundError,
  InvalidTokenError,
  NoAccessError,
  RateLimitedError,
  TelegramApiError,
} from "@achadinhos/telegram";
import type { TelegramClient } from "@achadinhos/telegram";

import type { Outcome } from "./types.js";

/**
 * `last_error` é sempre um texto fixo desta tabela: nunca a mensagem da
 * Shopee/Telegram (pode ecoar token, URL ou payload — checklist A, R6).
 */
export const MESSAGES = {
  shopeeRejected: "Credencial Shopee recusada (App ID ou Secret inválidos).",
  shopeeConfig: "Configuração do endpoint Shopee inválida.",
  telegramToken: "Token do bot Telegram inválido ou revogado.",
  groupRemoved: "O bot foi removido do grupo ou não tem acesso a ele.",
  groupNotFound: "Grupo não encontrado pelo Telegram.",
  groupNoRights: "O bot não tem permissão para enviar mensagens no grupo.",
  secretMissing: "Segredo não encontrado no cofre; salve a credencial novamente.",
  unavailable: "Serviço indisponível no momento; nova tentativa em instantes.",
  exhausted: "Não foi possível validar: serviço indisponível. Tente novamente.",
} as const;

const retry = (error: string): Outcome => ({ status: "retry", error });
const invalid = (error: string): Outcome => ({ status: "invalid", error });

export async function validateShopee(client: ShopeeClient): Promise<Outcome> {
  try {
    await client.productOfferV2({ limit: 1 });
    return { status: "validated" };
  } catch (error) {
    if (error instanceof ShopeeSignatureError) return invalid(MESSAGES.shopeeRejected);
    if (error instanceof ShopeeConfigError) return invalid(MESSAGES.shopeeConfig);
    if (error instanceof ShopeeHttpError && (error.status === 401 || error.status === 403)) {
      return invalid(MESSAGES.shopeeRejected);
    }
    // timeout, 429/5xx, rede, schema e erros GraphQL genéricos: não provam credencial ruim.
    return retry(MESSAGES.unavailable);
  }
}

export async function validateTelegramToken(client: TelegramClient): Promise<Outcome> {
  try {
    await client.getMe();
    return { status: "validated" };
  } catch (error) {
    return classifyTelegram(error, MESSAGES.telegramToken);
  }
}

export async function validateTelegramGroup(
  client: TelegramClient,
  externalId: string,
): Promise<Outcome> {
  try {
    await client.sendVerificationMessage(externalId);
    return { status: "validated" };
  } catch (error) {
    return classifyTelegram(error, MESSAGES.groupNoRights);
  }
}

function classifyTelegram(error: unknown, authMessage: string): Outcome {
  if (error instanceof InvalidTokenError) return invalid(MESSAGES.telegramToken);
  if (error instanceof RateLimitedError) return retry(MESSAGES.unavailable);
  if (error instanceof BotRemovedError || error instanceof BotBlockedError) {
    return invalid(MESSAGES.groupRemoved);
  }
  if (error instanceof ChatNotFoundError) return invalid(MESSAGES.groupNotFound);
  if (error instanceof NoAccessError) return invalid(authMessage);
  if (error instanceof TelegramApiError) {
    if (error.code === 401) return invalid(MESSAGES.telegramToken);
    if (error.code === 404) return invalid(MESSAGES.telegramToken);
    if (error.code !== undefined && error.code >= 400 && error.code < 500 && error.code !== 409) {
      return invalid(authMessage);
    }
  }
  return retry(MESSAGES.unavailable);
}
