import type { PGlite } from "@electric-sql/pglite";

export interface Seed {
  userId: string;
  accountId: string;
  channelId: string;
  groupId: string;
  automationId: string;
  botTokenSecretId: string;
  shopeeSecretId: string;
}

export const BOT_TOKEN = "123456:TEST-TOKEN-NAO-REAL";
export const SHOPEE_SECRET = "shopee-secret-nao-real";

/** Conta com 1 canal, 1 grupo, 1 automação e credenciais no Vault. Roda como dono. */
export async function seedAccount(db: PGlite, n = 1): Promise<Seed> {
  const q = async <T extends object>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows[0]!;
  const u = await q<{ id: string }>(
    "insert into auth.users (aud, role, email) values ('authenticated','authenticated', $1) returning id",
    [`worker-${n}-${Math.random()}@t.com`],
  );
  const acc = await q<{ account_id: string }>("insert into public.accounts (user_id) values ($1) returning account_id", [u.id]);
  const tok = await q<{ id: string }>("select vault.create_secret($1, $2) as id", [BOT_TOKEN, `tok-${n}-${Math.random()}`]);
  const shp = await q<{ id: string }>("select vault.create_secret($1, $2) as id", [SHOPEE_SECRET, `shp-${n}-${Math.random()}`]);
  const ch = await q<{ id: string }>(
    "insert into public.channels (account_id, kind, config_secret_id) values ($1,'telegram',$2) returning id",
    [acc.account_id, tok.id],
  );
  await db.query("insert into public.shopee_credentials (account_id, app_id, secret_id, status) values ($1,'app-1',$2,'validated')", [
    acc.account_id,
    shp.id,
  ]);
  const gr = await q<{ id: string }>(
    "insert into public.groups (account_id, channel_id, external_id, name, sub_id) values ($1,$2,'-1001234567890','Grupo A',$3) returning id",
    [acc.account_id, ch.id, `g${n}`],
  );
  const au = await q<{ id: string }>(
    `insert into public.automations (account_id, filters, days, window_start, window_end, frequency_min)
     values ($1, '{"keywords":"fone"}', ARRAY[0,1,2,3,4,5,6]::smallint[], '00:00', '23:59', 30) returning id`,
    [acc.account_id],
  );
  await db.query("insert into public.automation_groups (automation_id, account_id, group_id) values ($1,$2,$3)", [
    au.id,
    acc.account_id,
    gr.id,
  ]);
  return {
    userId: u.id,
    accountId: acc.account_id,
    channelId: ch.id,
    groupId: gr.id,
    automationId: au.id,
    botTokenSecretId: tok.id,
    shopeeSecretId: shp.id,
  };
}
