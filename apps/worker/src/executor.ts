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
import { DEFAULT_SHOPEE_LINK_HOSTS, isAllowedLink, isHttpsUrl } from "./links.ts";

import { UNKNOWN_RESULT_SUFFIX } from "@achadinhos/domain";
export { UNKNOWN_RESULT_SUFFIX };
const MAX_TITLE_LENGTH = 500;
const FINISH_ATTEMPTS = 3;
const FINISH_BACKOFF_MS = 100;

export interface ClaimedSend {
  sendId: string;
  accountId: string;
  automationId: string;
  groupId: string;
  /** `groups.sub_id`: curto, único por conta; vai na posição 2 dos subIds (lida pelo coletor de comissão). */
  groupSubId: string;
  channelId: string;
  offerId: string;
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
  | {
      status: "sent";
      externalMessageId: string;
      shortLink: string;
      /** Caminho do objeto no bucket, nunca a URL assinada. */
      creativeUrl: string;
      messageText: string;
    }
  | { status: "failed"; reason: string }
  | { status: "skipped"; reason: string };

export interface RunOutcome {
  status: FinishArgs["status"];
  reason?: string;
  finishRecorded: boolean;
  /** `finish_send` devolveu false: lease perdido para o reaper. */
  leaseLost?: boolean;
  finishError?: "finish_falhou";
}

export interface RenderInput {
  title: string;
  imageUrl: string;
  priceCurrent: number;
  priceOld: number;
  discountPct: number;
  affiliateHandle: string;
}

export interface StepTimeouts {
  clientsMs: number;
  finishMs: number;
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
  /** Hosts aceitos para productUrl e shortLink; padrão: Shopee. */
  linkHosts?: string[];
  fetchImage?: typeof fetch;
  /** Em produção: `renderCreativePng` de @achadinhos/creative/render. */
  renderCreative: (input: RenderInput) => Promise<Uint8Array>;
  /** Persiste o PNG (bucket privado) e devolve URL assinada de vida curta (decisão 002 C5). */
  creativeStore: {
    put: (png: Uint8Array, sendId: string) => Promise<{ photoUrl: string; objectPath: string }>;
  };
  /** finish_send (T7-03). */
  finish: (sendId: string, args: FinishArgs) => Promise<boolean>;
}

/** Margem entre o fim do pior caso e a expiração do lease. */
const LEASE_MARGIN_MS = 5_000;

/** Motivo é sempre um código fixo — nunca a mensagem do erro, que pode carregar segredo. */
export function reasonFor(error: unknown): string {
  if (error instanceof ImageRejectedError) return `imagem_${error.code}`;
  if (error instanceof StepTimeoutError) {
    return error.step === "telegram" ? `telegram_timeout${UNKNOWN_RESULT_SUFFIX}` : `timeout_${error.step}`;
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
  if (error instanceof TelegramTimeoutError) return `telegram_timeout${UNKNOWN_RESULT_SUFFIX}`;
  if (error instanceof TelegramTransportError) return `telegram_transporte${UNKNOWN_RESULT_SUFFIX}`;
  if (error instanceof TelegramApiError) return "telegram_api";
  if (error instanceof TelegramError) return "telegram_erro";
  return "erro_interno";
}

function buildCaption(title: string, link: string): string {
  const room = PHOTO_CAPTION_MAX - link.length - 1;
  const t = title.length > room ? `${title.slice(0, Math.max(0, room - 1))}…` : title;
  return `${t}\n${link}`;
}

/** Campo inválido da oferta/claim, ou undefined. Roda antes de qualquer chamada externa. */
export function invalidField(send: ClaimedSend): string | undefined {
  const blank = (v: unknown) => typeof v !== "string" || v.trim() === "";
  for (const k of ["sendId", "accountId", "automationId", "groupId", "groupSubId", "channelId", "offerId"] as const) {
    if (blank(send[k])) return k;
  }
  if (send.chatId === null || send.chatId === undefined || String(send.chatId).trim() === "") return "chatId";
  if (blank(send.affiliateHandle)) return "affiliateHandle";
  const o = send.offer;
  if (blank(o.title) || o.title.length > MAX_TITLE_LENGTH) return "title";
  if (!Number.isFinite(o.priceCurrent) || o.priceCurrent <= 0) return "priceCurrent";
  if (!Number.isFinite(o.priceOld) || o.priceOld < o.priceCurrent) return "priceOld";
  if (!Number.isFinite(o.discountPct) || o.discountPct < 0 || o.discountPct > 100) return "discountPct";
  if (!isHttpsUrl(o.productUrl)) return "productUrl";
  if (!isHttpsUrl(o.imageUrl)) return "imageUrl";
  return undefined;
}

class RenderFailedError extends Error {}
class InvalidLinkError extends Error {}
class InvalidTelegramResponseError extends Error {}

export function createSendExecutor(deps: ExecutorDeps) {
  const t = deps.timeouts;
  const linkHosts = deps.linkHosts ?? DEFAULT_SHOPEE_LINK_HOSTS;
  const worstCase =
    t.clientsMs + t.shortLinkMs + t.downloadMs + t.renderMs + t.storeMs + t.telegramMs +
    FINISH_ATTEMPTS * t.finishMs + (FINISH_ATTEMPTS - 1) * FINISH_BACKOFF_MS;
  if (worstCase + LEASE_MARGIN_MS > deps.leaseMs) {
    throw new Error(
      `timeouts somados (${worstCase} ms + margem ${LEASE_MARGIN_MS} ms) não cabem no lease de ${deps.leaseMs} ms`,
    );
  }

  /** Cada etapa respeita seu timeout e o orçamento restante do lease. */
  const step = <T>(work: () => Promise<T>, ms: number, name: string, deadline: number) =>
    withTimeout(Promise.resolve().then(work), Math.max(1, Math.min(ms, deadline - Date.now())), name);

  /** finish_send é idempotente (false se já terminou): repetir é seguro. Nunca lança nem vaza o erro. */
  async function finishWithRetry(sendId: string, args: FinishArgs, leaseEnd: number) {
    for (let attempt = 1; attempt <= FINISH_ATTEMPTS; attempt++) {
      try {
        const recorded = await withTimeout(
          Promise.resolve().then(() => deps.finish(sendId, args)),
          Math.max(1, Math.min(t.finishMs, leaseEnd - Date.now())),
          "finish",
        );
        return recorded ? { finishRecorded: true } : { finishRecorded: false, leaseLost: true };
      } catch {
        if (attempt < FINISH_ATTEMPTS) await new Promise((r) => setTimeout(r, FINISH_BACKOFF_MS));
      }
    }
    return { finishRecorded: false, finishError: "finish_falhou" as const };
  }

  async function run(send: ClaimedSend): Promise<RunOutcome> {
    const leaseEnd = Date.now() + deps.leaseMs;
    // reserva o orçamento do finish: as etapas externas terminam antes dele
    const deadline = leaseEnd - LEASE_MARGIN_MS - FINISH_ATTEMPTS * t.finishMs - (FINISH_ATTEMPTS - 1) * FINISH_BACKOFF_MS;
    let result: FinishArgs;
    const bad = invalidField(send);
    if (bad) {
      result = { status: "skipped", reason: `oferta_invalida_${bad}` };
    } else {
      try {
        const { shopee, telegram } = await step(() => deps.clients(send), t.clientsMs, "credenciais", deadline);
        if (!isAllowedLink(send.offer.productUrl, linkHosts)) throw new InvalidLinkError();
        const link = await step(
          () =>
            shopee.generateShortLink({
              originUrl: send.offer.productUrl,
              subIds: [send.accountId, send.automationId, send.groupSubId, send.channelId, send.sendId],
            }),
          t.shortLinkMs,
          "shopee",
          deadline,
        );
        if (!isAllowedLink(link?.shortLink, linkHosts)) throw new InvalidLinkError();
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
        const stored = await step(() => deps.creativeStore.put(png, send.sendId), t.storeMs, "armazenamento", deadline);
        const caption = buildCaption(send.offer.title, link.shortLink);
        const message = await step(
          () => telegram.sendPhoto({ chat_id: send.chatId, photo: stored.photoUrl, caption }),
          t.telegramMs,
          "telegram",
          deadline,
        );
        const id = (message as { message_id?: unknown } | undefined)?.message_id;
        if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) throw new InvalidTelegramResponseError();
        result = {
          status: "sent",
          externalMessageId: String(id),
          shortLink: link.shortLink,
          creativeUrl: stored.objectPath,
          messageText: caption,
        };
      } catch (error) {
        const reason =
          error instanceof RenderFailedError
            ? "render_falhou"
            : error instanceof InvalidLinkError
              ? "link_invalido"
              : error instanceof InvalidTelegramResponseError
                ? `telegram_resposta_invalida${UNKNOWN_RESULT_SUFFIX}`
                : reasonFor(error);
        result = { status: "failed", reason };
      }
    }
    const finished = await finishWithRetry(send.sendId, result, leaseEnd);
    return {
      status: result.status,
      ...("reason" in result ? { reason: result.reason } : {}),
      ...finished,
    };
  }

  return { run };
}
