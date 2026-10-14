import "server-only";
import { z } from "zod";
import type { ConnectionsRepo } from "./ports";
import type { OfferCandidate, OfferFinder, SendNowRepo, ShortLinkGateway } from "./send-ports";
import { SendNowError } from "./send-ports";
import { ActionError, type Session } from "./session";

export interface SendNowDeps {
  connections: ConnectionsRepo;
  sends: SendNowRepo;
  finder: OfferFinder;
  links: ShortLinkGateway;
  /** Relógio injetável (testes). */
  now?: () => Date;
}

/** O que a UI vê de uma oferta: sem links de afiliado nem dados brutos. */
export interface PublicOffer {
  itemId: string;
  title: string;
  imageUrl: string;
  price: number;
  oldPrice: number;
  discountPct: number;
  commissionRate: number;
  rating: number;
  sales: number;
  shopName: string;
  placeholderHue?: number;
}

export type OfferInput =
  | { kind: "keyword"; keyword: string }
  | { kind: "item"; itemId: string }
  | { kind: "short"; url: string }
  | { kind: "invalid"; message: string };

const SHOPEE_HOST = /^(?:[a-z0-9-]+\.)*shopee\.com\.br$/i;
const SHORT_HOSTS = new Set(["s.shopee.com.br", "shope.ee", "shp.ee"]);
const MAX_GROUPS = 20;
const REPEAT_WINDOW_DAYS = 7;
const DAY_MS = 86_400_000;

const isHttps = (u: string) => {
  try {
    return new URL(u).protocol === "https:";
  } catch {
    return false;
  }
};

export function parseOfferInput(raw: string): OfferInput {
  const text = raw.trim();
  if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) {
    if (text.length < 2) return { kind: "invalid", message: "Digite ao menos 2 caracteres." };
    if (text.length > 80) return { kind: "invalid", message: "Use no máximo 80 caracteres." };
    return { kind: "keyword", keyword: text };
  }
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { kind: "invalid", message: "URL inválida." };
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    return { kind: "invalid", message: "Use um link https da Shopee, sem usuário nem porta." };
  }
  if (SHORT_HOSTS.has(host)) return { kind: "short", url: url.toString() };
  if (!SHOPEE_HOST.test(host)) return { kind: "invalid", message: "Só aceitamos links da Shopee Brasil." };
  const m = url.pathname.match(/\/product\/\d+\/(\d+)/) ?? url.pathname.match(/-i\.\d+\.(\d+)/);
  if (!m) return { kind: "invalid", message: "Não encontramos o produto nesse link." };
  return { kind: "item", itemId: m[1]! };
}

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (r.success) return r.data;
  const fieldErrors: Record<string, string> = {};
  for (const issue of r.error.issues) fieldErrors[String(issue.path[0] ?? "_")] ??= issue.message;
  throw new ActionError("invalid", "Confira os campos.", fieldErrors);
}

function toPublic(c: OfferCandidate): PublicOffer {
  const discountPct = c.oldPrice > c.price && c.oldPrice > 0 ? Math.round((1 - c.price / c.oldPrice) * 100) : 0;
  return {
    itemId: c.itemId, title: c.title.slice(0, 200), imageUrl: c.imageUrl, price: c.price, oldPrice: c.oldPrice,
    discountPct, commissionRate: c.commissionRate, rating: c.rating, sales: c.sales, shopName: c.shopName.slice(0, 80),
    ...(c.placeholderHue !== undefined ? { placeholderHue: c.placeholderHue } : {}),
  };
}

/** Falha fechada: resposta da Shopee é dado; link ou imagem fora de https nunca chega à UI nem ao worker. */
const usable = (c: OfferCandidate | null): c is OfferCandidate =>
  !!c && isHttps(c.imageUrl) && isHttps(c.offerLink) && isHttps(c.productLink) && Number.isFinite(c.price) && c.price > 0;

const searchSchema = z.object({ q: z.string() }).strict();
const itemSchema = z.object({ itemId: z.string().regex(/^\d{1,20}$/, "Produto inválido."), groupIds: z.array(z.string().min(1).max(64)).max(MAX_GROUPS, `Escolha até ${MAX_GROUPS} grupos.`) }).strict();
const sendSchema = itemSchema.extend({ groupIds: z.array(z.string().min(1).max(64)).min(1, "Escolha ao menos um grupo.").max(MAX_GROUPS, `Escolha até ${MAX_GROUPS} grupos.`) }).strict();

export async function searchOffers(deps: SendNowDeps, session: Session, input: unknown): Promise<PublicOffer[]> {
  const { q } = parse(searchSchema, input);
  const p = parseOfferInput(q);
  if (p.kind === "invalid") throw new ActionError("invalid", p.message, { q: p.message });
  try {
    if (p.kind === "keyword") return (await deps.finder.search(session.accountId, p.keyword)).filter(usable).map(toPublic);
    const one = p.kind === "item" ? await deps.finder.byItemId(session.accountId, p.itemId) : await deps.finder.resolveShortUrl(session.accountId, p.url);
    return usable(one) ? [toPublic(one)] : [];
  } catch {
    throw new ActionError("upstream", "Não foi possível consultar a Shopee agora. Tente de novo em instantes.");
  }
}

async function loadOffer(deps: SendNowDeps, session: Session, itemId: string): Promise<OfferCandidate> {
  let c: OfferCandidate | null;
  try {
    c = await deps.finder.byItemId(session.accountId, itemId);
  } catch {
    throw new ActionError("upstream", "Não foi possível consultar a Shopee agora. Tente de novo em instantes.");
  }
  if (!usable(c)) throw new ActionError("not_found", "Produto não encontrado.");
  return c;
}

async function ownedGroups(deps: SendNowDeps, session: Session, groupIds: string[]) {
  const mine = await deps.connections.listGroups(session.accountId);
  const picked = [...new Set(groupIds)].map((id) => mine.find((g) => g.id === id));
  // Grupo alheio e grupo inexistente são indistinguíveis para o cliente.
  if (picked.some((g) => !g)) throw new ActionError("not_found", "Grupo não encontrado.");
  return picked as typeof mine;
}

export async function previewOffer(deps: SendNowDeps, session: Session, input: unknown) {
  const { itemId, groupIds } = parse(itemSchema, input);
  const offer = await loadOffer(deps, session, itemId);
  const groups = await ownedGroups(deps, session, groupIds);
  let shortLink: string;
  try {
    shortLink = await deps.links.generate(session.accountId, offer.offerLink, [session.accountId, "manual", "preview"]);
  } catch {
    throw new ActionError("upstream", "Não foi possível gerar o link curto agora.");
  }
  if (!isHttps(shortLink)) throw new ActionError("upstream", "Não foi possível gerar o link curto agora.");
  const now = (deps.now?.() ?? new Date()).getTime();
  const recent = await deps.sends.recentSent(session.accountId, itemId, groups.map((g) => g.id), new Date(now - REPEAT_WINDOW_DAYS * DAY_MS));
  const repeats = recent.map((r) => ({ groupId: r.groupId, daysAgo: Math.floor((now - r.at.getTime()) / DAY_MS) }));
  return { offer: toPublic(offer), shortLink, repeats };
}

export type SendNowItemStatus = "queued" | "already_queued";
export interface SendNowResult {
  results: { groupId: string; status: SendNowItemStatus; sendId: string }[];
}

export async function sendNow(deps: SendNowDeps, session: Session, input: unknown): Promise<SendNowResult> {
  const { itemId, groupIds } = parse(sendSchema, input);
  const groups = await ownedGroups(deps, session, groupIds);
  const inactive = groups.find((g) => !g.active);
  if (inactive) {
    throw new ActionError("invalid", "Confira os campos.", { groupIds: `O grupo “${inactive.name}” está inativo. Ative-o em Conexões.` });
  }
  const offer = await loadOffer(deps, session, itemId);
  const offerId = await deps.sends.saveOffer(session.accountId, offer);
  const results: SendNowResult["results"] = [];
  for (const g of groups) {
    try {
      const r = await deps.sends.enqueueSendNow(session.accountId, g.id, offerId);
      results.push({ groupId: g.id, status: r.duplicate ? "already_queued" : "queued", sendId: r.sendId });
    } catch (e) {
      if (e instanceof SendNowError) throw new ActionError(e.code === "forbidden" ? "forbidden" : "invalid", "Não foi possível enfileirar para esse grupo.");
      throw e;
    }
  }
  return { results };
}
