import type { Commission, CommissionRepository, CommissionSaveResult } from "../types.js";

/** Porta mínima de SQL (`pg`, `postgres.js` ou PGlite se adaptam a ela). Sem dependência de driver. */
export interface SqlClient {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface SubIdTotal {
  readonly subId: string;
  readonly total: number;
  readonly conversions: number;
}

export interface TotalsOptions {
  /** Início inclusivo da compra, em segundos Unix (UTC). */
  readonly fromSeconds?: number;
  /** Fim exclusivo da compra, em segundos Unix (UTC). */
  readonly toSeconds?: number;
}

/** Persistência de comissões de UMA conta via funções SQL (migração 20261015120000). */
export class SqlCommissionRepository implements Pick<CommissionRepository, "save"> {
  constructor(
    private readonly db: SqlClient,
    private readonly accountId: string,
  ) {}

  async save(commission: Commission): Promise<CommissionSaveResult> {
    if (commission.accountId !== undefined && commission.accountId !== null && String(commission.accountId) !== this.accountId) {
      throw new Error("commission belongs to another account");
    }
    const purchaseSeconds = Number(commission.purchaseTime);
    if (!Number.isFinite(purchaseSeconds)) throw new Error("invalid purchaseTime");

    const { rows } = await this.db.query<{ outcome: string; previous_status: string | null }>(
      `SELECT outcome, previous_status
         FROM public.record_commission($1::uuid, $2::text, $3::text[], to_timestamp($4::float8), $5::numeric, $6::text)`,
      [
        this.accountId,
        commission.checkoutId,
        [...commission.subIds],
        purchaseSeconds,
        commission.estimatedCommission,
        commission.status,
      ],
    );
    const row = rows[0];
    if (!row) throw new Error("record_commission returned no row");
    if (row.outcome === "inserted") return { inserted: true, updated: false, duplicate: false };
    if (row.outcome === "updated") {
      return row.previous_status
        ? { inserted: false, updated: true, duplicate: false, previousStatus: row.previous_status }
        : { inserted: false, updated: true, duplicate: false };
    }
    return { inserted: false, updated: false, duplicate: true };
  }

  async getLastCollectedAt(): Promise<number | null> {
    const { rows } = await this.db.query<{ t: number | string | null }>(
      `SELECT floor(extract(epoch FROM last_collected_at))::float8 AS t
         FROM public.commission_checkpoints WHERE account_id = $1::uuid`,
      [this.accountId],
    );
    const t = rows[0]?.t;
    return t === undefined || t === null ? null : Number(t);
  }

  async setLastCollectedAt(seconds: number): Promise<void> {
    await this.db.query(`SELECT public.set_commission_checkpoint($1::uuid, to_timestamp($2::float8))`, [
      this.accountId,
      seconds,
    ]);
  }

  /** Soma da comissão corrente por sub_id do grupo (canceladas fora). */
  async totalsBySubId(options: TotalsOptions = {}): Promise<SubIdTotal[]> {
    const { rows } = await this.db.query<{ sub_id: string; total: number | string; conversions: number | string }>(
      `SELECT sub_id, total::float8 AS total, conversions::int AS conversions
         FROM public.commission_totals_by_sub_id(
           $1::uuid,
           CASE WHEN $2::float8 IS NULL THEN NULL ELSE to_timestamp($2::float8) END,
           CASE WHEN $3::float8 IS NULL THEN NULL ELSE to_timestamp($3::float8) END)`,
      [this.accountId, options.fromSeconds ?? null, options.toSeconds ?? null],
    );
    return rows.map((r) => ({ subId: r.sub_id, total: Number(r.total), conversions: Number(r.conversions) }));
  }
}
