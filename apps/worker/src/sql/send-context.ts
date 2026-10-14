import { Secret } from "../config.js";
import type { ClaimedSend } from "../executor.js";
import type { SqlRunner } from "./client.js";
import { PgSecretVault } from "./vault.js";

export interface SendContextOptions {
  /**
   * Handle de afiliado impresso no criativo. `accounts` ainda não tem essa coluna, então a origem
   * (env, config da conta) é decisão de quem monta o worker.
   */
  affiliateHandle: (accountId: string) => string;
}

export interface ShopeeCredential {
  appId: string;
  secret: Secret;
}

type SendRow = {
  send_id: string;
  account_id: string;
  group_id: string;
  channel_id: string;
  offer_id: string;
  automation_id: string | null;
  sub_id: string;
  external_id: string;
  title: string | null;
  image_url: string | null;
  product_url: string | null;
  price: number | null;
  original_price: number | null;
  discount_pct: number | null;
};

/**
 * Contexto do envio lido do banco pelo worker: send claimado + grupo + canal + oferta, e as
 * credenciais (Shopee, token do canal) via Vault. Segredos saem embrulhados em `Secret`.
 */
export class PgSendContext {
  private readonly vault: PgSecretVault;

  constructor(
    private readonly db: SqlRunner,
    private readonly opts: SendContextOptions,
  ) {
    this.vault = new PgSecretVault(db);
  }

  /** `null` se o send não está em `sending` ou perdeu grupo/oferta (FK anulada). */
  async loadClaimedSend(sendId: string): Promise<ClaimedSend | null> {
    const r = await this.db.query<SendRow>(
      `select s.id as send_id, s.account_id, s.group_id, s.channel_id, s.offer_id,
              -- só a chave de slot (uuid-da-automacao:grupo:slot) identifica a automação; "Mandar agora"
              -- (prefixo now:) e qualquer outra chave são manuais: a comissão não vai para uma automação alheia
              case when s.idempotency_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:'
                   then split_part(s.idempotency_key, ':', 1) end as automation_id,
              g.sub_id, g.external_id,
              o.title, o.image_url, o.product_url,
              o.price::float8 as price, o.original_price::float8 as original_price, o.discount_pct::float8 as discount_pct
         from public.sends s
         join public.groups g on g.id = s.group_id
         join public.offers o on o.id = s.offer_id
        where s.id = $1::uuid and s.status = 'sending'`,
      [sendId],
    );
    const x = r.rows[0];
    if (!x) return null;
    return {
      sendId: x.send_id,
      accountId: x.account_id,
      automationId: x.automation_id ?? "manual",
      groupId: x.group_id,
      groupSubId: x.sub_id,
      channelId: x.channel_id,
      offerId: x.offer_id,
      chatId: /^-?\d+$/.test(x.external_id) ? Number(x.external_id) : x.external_id,
      affiliateHandle: this.opts.affiliateHandle(x.account_id),
      offer: {
        title: x.title ?? "",
        imageUrl: x.image_url ?? "",
        productUrl: x.product_url ?? "",
        priceCurrent: x.price ?? Number.NaN,
        priceOld: x.original_price ?? Number.NaN,
        discountPct: x.discount_pct ?? Number.NaN,
      },
    };
  }

  /** Credencial Shopee da conta (1 por conta). `null` se não cadastrada ou sem segredo. */
  async shopeeCredential(accountId: string): Promise<ShopeeCredential | null> {
    const r = await this.db.query<{ app_id: string; secret_id: string }>(
      "select app_id, secret_id from public.shopee_credentials where account_id = $1::uuid",
      [accountId],
    );
    const row = r.rows[0];
    if (!row) return null;
    const secret = await this.vault.read(row.secret_id);
    return secret ? { appId: row.app_id, secret: new Secret(secret) } : null;
  }

  /** Token do bot do canal (`channels.config_secret_id`); só se o canal é da conta informada. */
  async telegramToken(channelId: string, accountId: string): Promise<Secret | null> {
    const r = await this.db.query<{ config_secret_id: string }>(
      "select config_secret_id from public.channels where id = $1::uuid and account_id = $2::uuid",
      [channelId, accountId],
    );
    const row = r.rows[0];
    if (!row) return null;
    const secret = await this.vault.read(row.config_secret_id);
    return secret ? new Secret(secret) : null;
  }
}
