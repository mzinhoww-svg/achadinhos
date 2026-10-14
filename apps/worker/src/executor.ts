import {
  ShopeeGraphQLError,
  ShopeeSignatureError,
  ShopeeTimeoutError,
  ShopeeError,
  type ShopeeClient,
} from "@achadinhos/shopee";
import {
  BotBlockedError,
  BotRemovedError,
  CaptionTooLongError,
  ChatNotFoundError,
  NoAccessError,
  PHOTO_CAPTION_MAX,
  RateLimitedError,
  TelegramApiError,
  TelegramError,
  TelegramTimeoutError,
  TelegramTransportError,
  type TelegramClient,
} from "@achadinhos/telegram";
import { downloadProductImage, ImageRejectedError } from "./image.ts";
import { StepTimeoutError, withTimeout } from "./timeouts.ts";

export interface ClaimedSend {
  sendId: string;
  accountId: string;
  automationId: string;
  groupId: string;
  channelId: string;
  chatId: number | string;
  affiliateHandle: string;
  offer: {
    title: string;
    imageUrl: string;
    productUrl: string;
    priceCurrent: number;
    priceOld: number;
    discountPct: number;
  };
}

export type FinishArgs =
  | { status: "sent"; externalMessageId: string }
  | { status: "failed"; reason: string };

export interface RenderInput {
  title: string;
  imageUrl: string;
  priceCurrent: number;
  priceOld: number;
  discountPct: number;
  affiliateHandle: string;
}

export interface StepTimeouts {
  shortLinkMs: number;
  downloadMs: number;
  renderMs: number;
  storeMs: number;
  telegramMs: number;
}

export interface ExecutorDeps {
  /** Duração do lease da fila (T7-02); a soma dos timeouts deve caber nele. */
  leaseMs: number;
  timeouts: StepTimeouts;
  allowedImageHosts: string[];
  maxImageBytes: number;
  /** Clientes por envio (credenciais do Vault resolvidas fora do executor). */
  clients: (send: ClaimedSend) => Promise<{
    shopee: Pick<ShopeeClient, "generateShortLink">;
    telegram: Pick<TelegramClient, "sendPhoto">;
  }>;
  fetchImage?: typeof fetch;
  /** Em produção: `renderCreativePng` de @achadinhos/creative/render. */
  renderCreative: (input: RenderInput) => Promise<Uint8Array>;
  /** Persiste o PNG (bucket privado) e devolve URL assinada de vida curta (decisão 002 C5). */
  creativeStore: { put: (png: Uint8Array, sendId: string) => Promise<string> };
  /** finish_send (T7-03). */
  finish: (sendId: string, args: FinishArgs) => Promise<void>;
}

/** Margem entre o fim do pior caso e a expiração do lease. */
const LEASE_MARGIN_MS = 5_000;

/** Motivo é sempre um código fixo — nunca a mensagem do erro, que pode carregar segredo. */
export function reasonFor(error: unknown): string {
  if (error instanceof ImageRejectedError) return `imagem_${error.code}`;
  if (error instanceof StepTimeoutError) {
    return error.step === "telegram" ? "telegram_timeout_resultado_desconhecido" : `timeout_${error.step}`;
  }
  if (error instanceof ShopeeTimeoutError) return "timeout_shopee";
  if (error instanceof ShopeeSignatureError) return "shopee_assinatura_invalida";
  if (error instanceof ShopeeGraphQLError) return "shopee_graphql";
  if (error instanceof ShopeeError) return "shopee_erro";
  if (error instanceof RateLimitedError) return "telegram_rate_limit";
  if (error instanceof BotRemovedError) return "telegram_bot_removido";
  if (error instanceof BotBlockedError) return "telegram_bot_bloqueado";
  if (error instanceof NoAccessError) return "telegram_sem_acesso";
  if (error instanceof ChatNotFoundError) return "telegram_chat_nao_encontrado";
  if (error instanceof CaptionTooLongError) return "telegram_legenda_longa";
  if (error instanceof TelegramTimeoutError) return "telegram_timeout_resultado_desconhecido";
  if (error instanceof TelegramTransportError) return "telegram_transporte_resultado_desconhecido";
  if (error instanceof TelegramApiError) return "telegram_api";
  if (error instanceof TelegramError) return "telegram_erro";
  return "erro_interno";
}

function buildCaption(title: string, link: string): string {
  const room = PHOTO_CAPTION_MAX - link.length - 1;
  const t = title.length > room ? `${title.slice(0, Math.max(0, room - 1))}…` : title;
  return `${t}\n${link}`;
}

export function createSendExecutor(deps: ExecutorDeps) {
  const t = deps.timeouts;
  const worstCase = t.shortLinkMs + t.downloadMs + t.renderMs + t.storeMs + t.telegramMs;
  if (worstCase + LEASE_MARGIN_MS > deps.leaseMs) {
    throw new Error(
      `timeouts somados (${worstCase} ms + margem ${LEASE_MARGIN_MS} ms) não cabem no lease de ${deps.leaseMs} ms`,
    );
  }

  /** Cada etapa respeita seu timeout e o orçamento restante do lease. */
  const step = <T>(work: () => Promise<T>, ms: number, name: string, deadline: number) =>
    withTimeout(work(), Math.max(1, Math.min(ms, deadline - Date.now())), name);

  async function run(send: ClaimedSend): Promise<void> {
    const deadline = Date.now() + deps.leaseMs - LEASE_MARGIN_MS;
    let result: FinishArgs;
    try {
      const { shopee, telegram } = await deps.clients(send);
      const link = await step(
        () =>
          shopee.generateShortLink({
            originUrl: send.offer.productUrl,
            subIds: [send.accountId, send.automationId, send.groupId, send.channelId, send.sendId],
          }),
        t.shortLinkMs,
        "shopee",
        deadline,
      );
      const image = await downloadProductImage(send.offer.imageUrl, {
        allowedHosts: deps.allowedImageHosts,
        maxBytes: deps.maxImageBytes,
        timeoutMs: Math.max(1, Math.min(t.downloadMs, deadline - Date.now())),
        ...(deps.fetchImage ? { fetch: deps.fetchImage } : {}),
      });
      const dataUri = `data:${image.mime};base64,${Buffer.from(image.bytes).toString("base64")}`;
      const png = await step(
        async () => {
          try {
            return await deps.renderCreative({
              title: send.offer.title,
              imageUrl: dataUri,
              priceCurrent: send.offer.priceCurrent,
              priceOld: send.offer.priceOld,
              discountPct: send.offer.discountPct,
              affiliateHandle: send.affiliateHandle,
            });
          } catch {
            throw new RenderFailedError();
          }
        },
        t.renderMs,
        "render",
        deadline,
      );
      const photoUrl = await step(() => deps.creativeStore.put(png, send.sendId), t.storeMs, "armazenamento", deadline);
      const message = await step(
        () =>
          telegram.sendPhoto({
            chat_id: send.chatId,
            photo: photoUrl,
            caption: buildCaption(send.offer.title, link.shortLink),
          }),
        t.telegramMs,
        "telegram",
        deadline,
      );
      result = { status: "sent", externalMessageId: String(message.message_id) };
    } catch (error) {
      result = {
        status: "failed",
        reason: error instanceof RenderFailedError ? "render_falhou" : reasonFor(error),
      };
    }
    await deps.finish(send.sendId, result);
  }

  return { run };
}

class RenderFailedError extends Error {}
