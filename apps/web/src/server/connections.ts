import { z } from "zod";
import type { ConnectionsRepo, SecretVault, TelegramGateway, ValidationStatus } from "./ports";
import { sanitizeText } from "./sanitize";
import { ActionError, type Session } from "./session";

export interface ConnectionDeps {
  repo: ConnectionsRepo;
  vault: SecretVault;
  telegram: TelegramGateway;
}

/** O que a UI pode ver: nunca o Secret/token; Shopee mostra só os 4 últimos caracteres. */
export interface PublicShopee {
  appId: string;
  secretLast4: string;
  status: ValidationStatus;
  validatedAt: string | null;
  lastError: string | null;
}
export interface PublicGroup {
  id: string;
  name: string;
  chatType: string;
  subId: string;
  active: boolean;
  members: number;
}
export interface PublicTelegram {
  botName: string;
  status: ValidationStatus;
  validatedAt: string | null;
  lastError: string | null;
  groups: PublicGroup[];
}

const GROUP_TYPES = new Set(["group", "supergroup", "channel"]);

const shopeeSchema = z.object({
  appId: z.string().trim().regex(/^\d{6,20}$/, "Use só números (6 a 20 dígitos)."),
  secret: z.string().trim().min(16, "O Secret tem pelo menos 16 caracteres.").max(256),
});
const telegramSchema = z.object({
  token: z.string().trim().regex(/^\d{5,}:[A-Za-z0-9_-]{20,}$/, "Formato de token inválido."),
});
const toggleSchema = z.object({ groupId: z.string().min(1).max(64), active: z.boolean() });

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (r.success) return r.data;
  const fieldErrors: Record<string, string> = {};
  for (const issue of r.error.issues) fieldErrors[String(issue.path[0] ?? "_")] ??= issue.message;
  throw new ActionError("invalid", "Confira os campos.", fieldErrors);
}

export async function saveShopee(deps: ConnectionDeps, session: Session, input: unknown): Promise<PublicShopee> {
  const { appId, secret } = parse(shopeeSchema, input);
  const secretId = await deps.vault.put(session.accountId, "shopee_secret", secret);
  const rec = {
    accountId: session.accountId,
    appId,
    secretId,
    secretLast4: secret.slice(-4),
    status: "pending_validation" as const,
    validatedAt: null,
    lastError: null,
  };
  await deps.repo.saveShopee(rec);
  return toPublicShopee(rec);
}

export async function saveTelegram(deps: ConnectionDeps, session: Session, input: unknown): Promise<PublicTelegram> {
  const { token } = parse(telegramSchema, input);
  let botName: string;
  let chats: Awaited<ReturnType<TelegramGateway["listChats"]>>;
  try {
    botName = (await deps.telegram.verifyToken(token)).botName;
    chats = await deps.telegram.listChats(token);
  } catch (e) {
    const detail = sanitizeText(e instanceof Error ? e.message : "erro", [token]);
    throw new ActionError("upstream", `Não foi possível validar o bot (${detail}).`);
  }
  const secretId = await deps.vault.put(session.accountId, "telegram_token", token);
  await deps.repo.saveChannel({
    accountId: session.accountId,
    secretId,
    botName,
    status: "pending_validation",
    validatedAt: null,
    lastError: null,
  });
  const groups = await deps.repo.syncGroups(
    session.accountId,
    chats
      .filter((c) => GROUP_TYPES.has(c.chatType)) // chat privado nunca vira grupo
      .map((c) => ({ chatId: c.chatId, name: c.name, chatType: c.chatType as "group", members: c.members })),
  );
  return { botName, status: "pending_validation", validatedAt: null, lastError: null, groups: groups.map(toPublicGroup) };
}

export async function setGroupActive(deps: ConnectionDeps, session: Session, input: unknown): Promise<PublicGroup> {
  const { groupId, active } = parse(toggleSchema, input);
  const g = await deps.repo.setGroupActive(session.accountId, groupId, active);
  if (!g) throw new ActionError("not_found", "Grupo não encontrado.");
  return toPublicGroup(g);
}

export async function getConnections(deps: ConnectionDeps, session: Session) {
  const [shopee, channel, groups] = await Promise.all([
    deps.repo.getShopee(session.accountId),
    deps.repo.getChannel(session.accountId),
    deps.repo.listGroups(session.accountId),
  ]);
  return {
    shopee: shopee ? toPublicShopee(shopee) : null,
    telegram: channel
      ? ({ botName: channel.botName, status: channel.status, validatedAt: channel.validatedAt, lastError: channel.lastError, groups: groups.map(toPublicGroup) } satisfies PublicTelegram)
      : null,
  };
}

function toPublicShopee(r: { appId: string; secretLast4: string; status: ValidationStatus; validatedAt: string | null; lastError: string | null }): PublicShopee {
  return { appId: r.appId, secretLast4: r.secretLast4, status: r.status, validatedAt: r.validatedAt, lastError: r.lastError };
}
function toPublicGroup(g: { id: string; name: string; chatType: string; subId: string; active: boolean; members: number }): PublicGroup {
  return { id: g.id, name: g.name, chatType: g.chatType, subId: g.subId, active: g.active, members: g.members };
}
