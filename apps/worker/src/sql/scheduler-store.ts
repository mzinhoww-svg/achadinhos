import type { OfferFilters } from "@achadinhos/domain";
import type {
  AutomationRow,
  DueGroup,
  NewSend,
  ProductOfferNode,
  SchedulerStore,
  SchedulerTx,
  SendHistoryRow,
} from "../scheduler-ports.js";
import type { SqlClient, SqlRunner } from "./client.js";

type DueRow = {
  automation_id: string;
  group_id: string;
  account_id: string;
  channel_id: string;
  next_run_at: Date | null;
  a_status: AutomationRow["status"];
  days: number[];
  window_start: string;
  window_end: string;
  frequency_min: 15 | 30 | 60;
  filters: unknown;
  timezone: string;
};

/**
 * Colunas lidas por `listDueGroups` e `lockGroup`. Janela em HH:MM (a coluna é `time`); o fuso é o
 * IANA da conta (decisão 001 A7). `filters` é dado do usuário: só objeto simples passa adiante.
 */
const DUE_SELECT = `
  select ag.automation_id, ag.group_id, ag.account_id, g.channel_id, ag.next_run_at,
         a.status as a_status, a.days, to_char(a.window_start, 'HH24:MI') as window_start,
         to_char(a.window_end, 'HH24:MI') as window_end, a.frequency_min, a.filters, acc.timezone
    from public.automation_groups ag
    join public.automations a on a.account_id = ag.account_id and a.id = ag.automation_id
    join public.groups g on g.account_id = ag.account_id and g.id = ag.group_id
    join public.accounts acc on acc.account_id = ag.account_id
   where a.status = 'active' and g.active
     and (ag.next_run_at is null or ag.next_run_at <= $1)`;

function toDue(r: DueRow): DueGroup {
  const filters: OfferFilters =
    r.filters !== null && typeof r.filters === "object" && !Array.isArray(r.filters) ? (r.filters as OfferFilters) : {};
  return {
    automationId: r.automation_id,
    groupId: r.group_id,
    accountId: r.account_id,
    channelId: r.channel_id,
    nextRunAt: r.next_run_at,
    automation: {
      id: r.automation_id,
      accountId: r.account_id,
      status: r.a_status,
      days: r.days.map(Number),
      windowStart: r.window_start,
      windowEnd: r.window_end,
      frequencyMin: r.frequency_min,
      filters,
      timezone: r.timezone,
    },
  };
}

const OPEN_SEND = `
  select 1 from public.sends
   where group_id = $2 and status in ('queued','sending') and starts_with(idempotency_key, $1 || ':' || $2 || ':')
   limit 1`;

class PgTx implements SchedulerTx {
  constructor(private readonly q: SqlRunner) {}

  async lockGroup(automationId: string, groupId: string, now: Date): Promise<DueGroup | null> {
    const r = await this.q.query<DueRow>(
      `${DUE_SELECT} and ag.automation_id = $2::uuid and ag.group_id = $3::uuid
       for update of ag skip locked`,
      [now, automationId, groupId],
    );
    return r.rows[0] ? toDue(r.rows[0]) : null;
  }

  async hasOpenSend(automationId: string, groupId: string): Promise<boolean> {
    return (await this.q.query(OPEN_SEND, [automationId, groupId])).rows.length > 0;
  }

  async upsertOffer(accountId: string, o: ProductOfferNode): Promise<{ id: string }> {
    const r = await this.q.query<{ id: string }>(
      `insert into public.offers
         (account_id, item_id, title, price, original_price, discount_pct, commission_rate, rating, sales,
          image_url, product_url, raw, fetched_at)
       values ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, now())
       on conflict (account_id, item_id) do update set
         title = excluded.title, price = excluded.price, original_price = excluded.original_price,
         discount_pct = excluded.discount_pct, commission_rate = excluded.commission_rate,
         rating = excluded.rating, sales = excluded.sales, image_url = excluded.image_url,
         product_url = excluded.product_url, raw = excluded.raw, fetched_at = now()
       returning id`,
      [
        accountId,
        String(o.itemId),
        o.productName,
        o.priceMin,
        o.priceMax,
        o.priceDiscountRate,
        Number(o.commissionRate),
        o.ratingStar,
        Math.trunc(o.sales),
        o.imageUrl,
        o.productLink,
        JSON.stringify(o),
      ],
    );
    return { id: r.rows[0]!.id };
  }

  async insertSend(s: NewSend): Promise<boolean> {
    // `skipped` nasce terminal (a constraint exige finished_at); sem retry e sem claim.
    // ON CONFLICT sem alvo: cobre a chave de slot E o par (grupo, oferta) já em voo (M4).
    const r = await this.q.query<{ id: string }>(
      `insert into public.sends
         (account_id, group_id, channel_id, offer_id, status, reason, idempotency_key, scheduled_for, finished_at)
       values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8,
               case when $5 = 'queued' then null else now() end)
       on conflict do nothing
       returning id`,
      [s.accountId, s.groupId, s.channelId, s.offerId, s.status, s.reason, s.idempotencyKey, s.scheduledFor],
    );
    return r.rows.length === 1;
  }

  async setNextRunAt(automationId: string, groupId: string, next: Date): Promise<void> {
    await this.q.query(
      "update public.automation_groups set next_run_at = $3 where automation_id = $1::uuid and group_id = $2::uuid",
      [automationId, groupId, next],
    );
  }
}

/** SchedulerStore (T7-05) sobre Postgres: lock de linha com SKIP LOCKED e commit atômico (A9). */
export class PgSchedulerStore implements SchedulerStore {
  constructor(private readonly db: SqlClient) {}

  async listDueGroups(now: Date, limit: number): Promise<DueGroup[]> {
    const r = await this.db.query<DueRow>(
      `${DUE_SELECT} order by ag.next_run_at nulls first, ag.automation_id, ag.group_id limit $2`,
      [now, limit],
    );
    return r.rows.map(toDue);
  }

  async listRecentSends(groupId: string, since: Date): Promise<SendHistoryRow[]> {
    const r = await this.db.query<{
      item_id: string | null;
      status: SendHistoryRow["status"];
      reason: string | null;
      sent_at: Date | null;
      attempted_at: Date | null;
      created_at: Date;
    }>(
      `select o.item_id, s.status, s.reason, s.sent_at, s.attempted_at, s.created_at
         from public.sends s
         left join public.offers o on o.id = s.offer_id
        where s.group_id = $1::uuid and s.created_at >= $2
        order by s.created_at desc`,
      [groupId, since],
    );
    return r.rows.map((x) => ({
      itemId: x.item_id,
      status: x.status,
      reason: x.reason,
      sentAt: x.sent_at,
      attemptedAt: x.attempted_at,
      createdAt: x.created_at,
    }));
  }

  async hasOpenSend(automationId: string, groupId: string): Promise<boolean> {
    return (await this.db.query(OPEN_SEND, [automationId, groupId])).rows.length > 0;
  }

  transaction<T>(fn: (tx: SchedulerTx) => Promise<T>): Promise<T> {
    return this.db.transaction((q) => fn(new PgTx(q)));
  }
}
