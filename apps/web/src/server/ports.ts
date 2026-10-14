/** Portas do T8. Implementação real (Supabase sob RLS + RPC do Vault) entra depois; testes usam memória. */

export interface SecretVault {
  /** Grava o valor e devolve só o id. Não existe leitura aqui: quem lê é o worker (decisão 003 H1). */
  put(accountId: string, kind: "shopee_secret" | "telegram_token", value: string): Promise<string>;
}

export type ValidationStatus = "pending_validation" | "validated" | "invalid";

export interface ShopeeCredentialRecord {
  accountId: string;
  appId: string;
  secretId: string;
  secretLast4: string;
  status: ValidationStatus;
  validatedAt: string | null;
  lastError: string | null;
}

export interface ChannelRecord {
  accountId: string;
  secretId: string;
  botName: string;
  status: ValidationStatus;
  validatedAt: string | null;
  lastError: string | null;
}

export interface GroupRecord {
  id: string;
  accountId: string;
  chatId: string;
  name: string;
  chatType: "group" | "supergroup" | "channel";
  subId: string;
  active: boolean;
  members: number;
}

export interface AutomationRecord {
  id: string;
  accountId: string;
  name: string;
  status: "active" | "paused";
  filters: Record<string, unknown>;
  days: number[];
  windowStart: string;
  windowEnd: string;
  frequencyMin: 15 | 30 | 60;
  header: string | null;
  footer: string | null;
  groupIds: string[];
  createdAt: string;
}

export type AutomationDraft = Omit<AutomationRecord, "id" | "accountId" | "createdAt">;

export interface ConnectionsRepo {
  getShopee(accountId: string): Promise<ShopeeCredentialRecord | null>;
  saveShopee(rec: ShopeeCredentialRecord): Promise<void>;
  getChannel(accountId: string): Promise<ChannelRecord | null>;
  saveChannel(rec: ChannelRecord): Promise<void>;
  listGroups(accountId: string): Promise<GroupRecord[]>;
  /** Insere grupos novos (sub_id único por conta) e preserva `active`/`subId` dos existentes. */
  syncGroups(accountId: string, found: Omit<GroupRecord, "id" | "accountId" | "subId" | "active">[]): Promise<GroupRecord[]>;
  setGroupActive(accountId: string, groupId: string, active: boolean): Promise<GroupRecord | null>;
}

export class AutomationLimitError extends Error {}

export interface AutomationsRepo {
  list(accountId: string): Promise<AutomationRecord[]>;
  get(accountId: string, id: string): Promise<AutomationRecord | null>;
  /** Contagem e inserção na mesma seção crítica: à prova de corrida (no banco: lock por conta). */
  createWithinLimit(accountId: string, draft: AutomationDraft, max: number): Promise<AutomationRecord>;
  update(accountId: string, id: string, draft: AutomationDraft): Promise<AutomationRecord | null>;
  remove(accountId: string, id: string): Promise<boolean>;
}

export interface TelegramGateway {
  /** Valida o token e devolve o nome do bot. Nunca ecoa o token. */
  verifyToken(token: string): Promise<{ botName: string }>;
  listChats(token: string): Promise<{ chatId: string; name: string; chatType: string; members: number }[]>;
}
