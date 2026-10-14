import { beforeAll, describe, expect, it } from "vitest";
import { createSupabaseRepos } from "../../src/server/supabase/repos";
import { createSupabaseSessions } from "../../src/server/supabase/session";
import { saveShopee, saveTelegram, setGroupActive, getConnections } from "../../src/server/connections";
import { createAutomation, updateAutomation, deleteAutomation, listAutomations } from "../../src/server/automations";
import { getOnboarding } from "../../src/server/onboarding";
import { getEnvios } from "../../src/server/envios";
import { SendNowError, type OfferCandidate } from "../../src/server/send-ports";
import { fakeTelegram, SECRET_CANARY, TOKEN_CANARY } from "../helpers";
import { createDb, rpcAs, type TestDb } from "./harness";

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const offer = (itemId: string, over: Partial<OfferCandidate> = {}): OfferCandidate => ({
  itemId, title: `Produto ${itemId}`, imageUrl: "https://img.example/x.jpg", productLink: `https://shopee.com.br/p/${itemId}`,
  offerLink: `https://shopee.com.br/p/${itemId}?af=1`, price: 49.9, oldPrice: 99.9, commissionRate: 8, rating: 4.8, sales: 1200, shopName: "Loja", ...over,
});
const autoInput = (groupIds: string[], name = "Eletrônicos") => ({
  name, days: [1, 2, 3], windowStart: "08:00", windowEnd: "22:00", frequencyMin: 30,
  filters: { category: "Eletrônicos", priceMax: 150 }, groupIds,
});

let t: TestDb;
function stack(userId: string) {
  const rpc = rpcAs(t, userId);
  const repos = createSupabaseRepos(rpc);
  const sessions = createSupabaseSessions({ getUser: async () => ({ data: { user: { id: userId } }, error: null }) }, rpc);
  const telegram = fakeTelegram();
  return { rpc, ...repos, sessions, telegram, deps: { repo: repos.connections, vault: repos.vault, telegram } };
}

beforeAll(async () => {
  t = await createDb();
  await t.addUser(A);
  await t.addUser(B);
}, 60_000);

describe("sessão", () => {
  it("accountId vem do banco a partir do usuário autenticado; sem usuário não há sessão", async () => {
    const s = await stack(A).sessions.current();
    expect(s?.userId).toBe(A);
    expect(s?.accountId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await stack(A).sessions.current()).toEqual(s); // estável (não cria 2ª conta)
    const none = createSupabaseSessions({ getUser: async () => ({ data: { user: null }, error: { message: "jwt expired" } }) }, rpcAs(t, A));
    expect(await none.current()).toBeNull();
  });
});

describe("conexões + Vault write-only", () => {
  it("Secret/token vão para o Vault por RPC e nunca voltam em nenhuma leitura", async () => {
    const a = stack(A);
    const s = (await a.sessions.current())!;
    await saveShopee(a.deps, s, { appId: "18350000042", secret: SECRET_CANARY });
    await saveTelegram(a.deps, s, { token: TOKEN_CANARY });

    const vault = await t.db.query<{ secret: string; name: string }>("select secret, name from vault.secrets");
    expect(vault.rows.map((r) => r.secret).sort()).toEqual([SECRET_CANARY, TOKEN_CANARY].sort());
    expect(vault.rows.every((r) => r.name.startsWith(`achadinhos/${s.accountId}/`))).toBe(true);

    const everything = JSON.stringify([
      await getConnections(a.deps, s),
      await a.rpc("web_get_shopee"),
      await a.rpc("web_get_channel"),
      await a.rpc("web_list_groups"),
    ]);
    expect(everything).not.toContain(SECRET_CANARY);
    expect(everything).not.toContain(TOKEN_CANARY);
    const view = await getConnections(a.deps, s);
    expect(view.shopee).toMatchObject({ appId: "18350000042", secretLast4: SECRET_CANARY.slice(-4), status: "pending_validation" });
    expect(view.telegram?.botName).toBe("@achadinhos_teste_bot");
    expect(view.telegram?.groups.map((g) => g.name).sort()).toEqual(["Canal Casa", "Grupo Tech"]); // privado fora
  });

  it("o papel authenticated não lê vault.secrets nem a tabela por fora das RPCs", async () => {
    const r = await t.asUser(A, async () => {
      try { await t.db.query("select secret from vault.secrets"); return "lido"; } catch (e) { return (e as { code?: string }).code; }
    });
    expect(r).toBe("42501");
  });

  it("isolamento: B não vê nada de A e não troca grupo de A", async () => {
    const a = stack(A); const b = stack(B);
    const sA = (await a.sessions.current())!; const sB = (await b.sessions.current())!;
    expect(sA.accountId).not.toBe(sB.accountId);
    expect((await getConnections(b.deps, sB)).shopee).toBeNull();
    const [g] = await a.connections.listGroups(sA.accountId);
    await expect(setGroupActive(b.deps, sB, { groupId: g!.id, active: true })).rejects.toMatchObject({ code: "not_found" });
    await expect(setGroupActive(b.deps, sB, { groupId: "nao-e-uuid", active: true })).rejects.toMatchObject({ code: "not_found" });
  });

  it("accountId forjado no parâmetro do repositório não muda de conta (vale a sessão do banco)", async () => {
    const b = stack(B);
    const sA = (await stack(A).sessions.current())!;
    expect(await b.connections.getShopee(sA.accountId)).toBeNull();
    expect(await b.connections.listGroups(sA.accountId)).toEqual([]);
  });

  it("sub_id é estável ao ressincronizar e novos grupos nascem inativos", async () => {
    const a = stack(A); const s = (await a.sessions.current())!;
    const before = await a.connections.listGroups(s.accountId);
    const again = await saveTelegram(a.deps, s, { token: TOKEN_CANARY });
    expect(again.groups.map((g) => g.subId).sort()).toEqual(before.map((g) => g.subId).sort());
    expect(before.every((g) => g.active === false)).toBe(true);
    const on = await setGroupActive(a.deps, s, { groupId: before[0]!.id, active: true });
    expect(on.active).toBe(true);
    expect((await a.connections.listGroups(s.accountId)).find((g) => g.id === before[0]!.id)?.active).toBe(true);
  });
});

describe("automações", () => {
  it("CRUD só com grupos ativos da conta e limite de 5 à prova de corrida", async () => {
    const a = stack(A); const s = (await a.sessions.current())!;
    const active = (await a.connections.listGroups(s.accountId)).filter((g) => g.active).map((g) => g.id);
    expect(active.length).toBeGreaterThan(0);
    const deps = { automations: a.automations, connections: a.connections };

    const made = await createAutomation(deps, s, autoInput(active));
    expect(made).toMatchObject({ name: "Eletrônicos", status: "active", days: [1, 2, 3], windowStart: "08:00", windowEnd: "22:00", frequencyMin: 30 });
    expect(made.groupIds).toEqual(active);
    expect(made.filters).toMatchObject({ category: "Eletrônicos", priceMax: 150 });

    const upd = await updateAutomation(deps, s, { id: made.id, ...autoInput(active, "Renomeada") });
    expect(upd.name).toBe("Renomeada");

    const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => createAutomation(deps, s, autoInput(active, `n${i}`))));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(4); // 1 + 4 = 5
    expect(results.filter((r) => r.status === "rejected").every((r) => (r as PromiseRejectedResult).reason?.code === "limit")).toBe(true);
    expect(await listAutomations(deps, s)).toHaveLength(5);

    const b = stack(B); const sB = (await b.sessions.current())!;
    expect(await listAutomations({ automations: b.automations, connections: b.connections }, sB)).toEqual([]);
    expect(await b.automations.get(sB.accountId, made.id)).toBeNull();
    expect(await b.automations.remove(sB.accountId, made.id)).toBe(false);

    await deleteAutomation(deps, s, { id: made.id });
    expect(await listAutomations(deps, s)).toHaveLength(4);
  });

  it("grupo de outra conta no corpo é recusado pelo banco (FK composta), mesmo sem a checagem da aplicação", async () => {
    const a = stack(A); const b = stack(B); const sB = (await b.sessions.current())!;
    const [g] = (await a.connections.listGroups((await a.sessions.current())!.accountId));
    await expect(b.automations.createWithinLimit(sB.accountId, { name: "x", status: "active", filters: {}, days: [1], windowStart: "08:00", windowEnd: "09:00", frequencyMin: 30, header: null, footer: null, groupIds: [g!.id] }, 5)).rejects.toBeDefined();
    expect(await b.automations.list(sB.accountId)).toEqual([]); // transação inteira desfeita
  });
});

describe("Mandar agora + Envios", () => {
  it("enfileira com prioridade 100, deduplica duplo clique e recusa grupo inativo/alheio", async () => {
    const a = stack(A); const s = (await a.sessions.current())!;
    const groups = await a.connections.listGroups(s.accountId);
    const on = groups.find((g) => g.active)!; const off = groups.find((g) => !g.active)!;
    const offerId = await a.sendNow.saveOffer(s.accountId, offer("9001"));
    expect(await a.sendNow.saveOffer(s.accountId, offer("9001", { price: 39.9 }))).toBe(offerId); // upsert por item

    const first = await a.sendNow.enqueueSendNow(s.accountId, on.id, offerId);
    expect(first.duplicate).toBe(false);
    const dbl = await a.sendNow.enqueueSendNow(s.accountId, on.id, offerId);
    expect(dbl).toEqual({ sendId: first.sendId, duplicate: true });
    const row = await t.db.query<{ status: string; priority: number }>("select status, priority from sends where id = $1", [first.sendId]);
    expect(row.rows[0]).toEqual({ status: "queued", priority: 100 });

    await expect(a.sendNow.enqueueSendNow(s.accountId, off.id, offerId)).rejects.toMatchObject({ code: "group_inactive" });
    const b = stack(B); const sB = (await b.sessions.current())!;
    await expect(b.sendNow.enqueueSendNow(sB.accountId, on.id, offerId)).rejects.toBeInstanceOf(SendNowError);
    await expect(b.sendNow.enqueueSendNow(sB.accountId, on.id, offerId)).rejects.toMatchObject({ code: "forbidden" });

    const listed = await a.sendNow.listOffers(s.accountId);
    expect(listed[0]).toMatchObject({ itemId: "9001", price: 39.9, offerLink: "https://shopee.com.br/p/9001?af=1", shopName: "Loja" });
    expect(await b.sendNow.listOffers(sB.accountId)).toEqual([]);
  });

  it("cliente não insere/atualiza sends direto (só pela RPC)", async () => {
    const r = await t.asUser(A, async () => {
      try { await t.db.query("insert into sends (account_id, status, idempotency_key) select account_id, 'sent', 'x' from accounts limit 1"); return "inseriu"; }
      catch (e) { return (e as { code?: string }).code; }
    });
    expect(r).toBe("42501");
  });

  it("recentSent e lista de Envios com origem e fuso da conta", async () => {
    const a = stack(A); const s = (await a.sessions.current())!;
    const groups = await a.connections.listGroups(s.accountId);
    const g = groups.find((x) => x.active)!;
    const [{ id: offerId }] = (await t.db.query<{ id: string }>("select id from offers where item_id = '9001'")).rows as [{ id: string }];
    // histórico escrito pelo worker (service_role/superuser): enviado há 2h, com a origem registrada
    await t.db.query(
      `insert into sends (account_id, offer_id, group_id, channel_id, status, priority, idempotency_key, scheduled_for, attempted_at, finished_at, sent_at, external_message_id, short_link, automation_name)
       select g.account_id, $1, g.id, g.channel_id, 'sent', 0, 'hist-1', now() - interval '2 hours', now() - interval '2 hours', now() - interval '2 hours', now() - interval '2 hours', 'm1', 'https://s.shopee.com.br/abc', 'Eletrônicos'
       from groups g where g.id = $2`, [offerId, g.id]);

    const since = new Date(Date.now() - 24 * 3600_000);
    const recent = await a.sendNow.recentSent(s.accountId, "9001", [g.id], since);
    expect(recent).toHaveLength(1);
    expect(recent[0]!.groupId).toBe(g.id);
    expect(await a.sendNow.recentSent(s.accountId, "9001", [g.id], new Date())).toEqual([]);

    const view = await getEnvios({ sends: a.sends }, s, {});
    expect(view.timeZone).toBe("America/Cuiaba");
    const sent = view.items.find((i) => i.status === "sent")!;
    expect(sent).toMatchObject({ origin: "Eletrônicos", groupName: g.name, shortLink: "https://s.shopee.com.br/abc" });
    expect(view.items.some((i) => i.status === "queued" && i.origin === "Manual")).toBe(true);
    const b = stack(B); const sB = (await b.sessions.current())!;
    expect((await getEnvios({ sends: b.sends }, sB, {})).items).toEqual([]);
  });
});

describe("onboarding", () => {
  it("deriva os passos do banco da conta; validação do worker reflete no checklist", async () => {
    const a = stack(A); const s = (await a.sessions.current())!;
    const od = { connections: a.connections, automations: a.automations };
    let ob = await getOnboarding(od, s);
    expect(ob.steps.find((x) => x.key === "shopee")?.state).toBe("pending");
    expect(ob.steps.find((x) => x.key === "telegram")?.state).toBe("pending");

    // o worker (service_role) valida e grava
    await t.db.query("update shopee_credentials set status = 'validated', validated_at = now() where account_id = $1", [s.accountId]);
    await t.db.query("update channels set validation_status = 'invalid', last_error = 'token recusado' where account_id = $1", [s.accountId]);
    ob = await getOnboarding(od, s);
    expect(ob.steps.find((x) => x.key === "shopee")?.state).toBe("done");
    expect(ob.steps.find((x) => x.key === "telegram")).toMatchObject({ state: "error", detail: "token recusado" });
    expect(ob.steps.find((x) => x.key === "groups")?.state).toBe("blocked");

    const b = stack(B); const sB = (await b.sessions.current())!;
    const obB = await getOnboarding({ connections: b.connections, automations: b.automations }, sB);
    expect(obB.doneCount).toBe(0);
  });
});

describe("RLS e privilégios (sem passar pelos adaptadores)", () => {
  it("SELECT direto como B não enxerga linhas de A em nenhuma tabela do painel", async () => {
    const counts = await t.asUser(B, async () => {
      const out: Record<string, number> = {};
      for (const tb of ["shopee_credentials", "channels", "groups", "automations", "automation_groups", "offers", "sends", "send_status_events"]) {
        out[tb] = (await t.db.query<{ n: number }>(`select count(*)::int n from public.${tb}`)).rows[0]!.n;
      }
      return out;
    });
    expect(Object.values(counts).every((n) => n === 0)).toBe(true);
    const asA = await t.asUser(A, async () => (await t.db.query<{ n: number }>("select count(*)::int n from public.groups")).rows[0]!.n);
    expect(asA).toBeGreaterThan(0);
  });

  it("anon e chamadas sem sessão não executam as RPCs", async () => {
    const anon = await (async () => {
      await t.db.exec("set role anon");
      try { await t.db.query("select public.web_account()"); return "executou"; } catch (e) { return (e as { code?: string }).code; } finally { await t.db.exec("reset role"); }
    })();
    expect(anon).toBe("42501");
    const noSub = await t.asUser("", async () => {
      try { await t.db.query("select public.web_account()"); return "executou"; } catch (e) { return (e as { message?: string }).message; }
    });
    expect(noSub).toMatch(/unauthenticated/);
  });

  it("RPC não aceita segredo de outra conta nem de outro uso", async () => {
    const a = stack(A); const b = stack(B);
    const idA = await a.vault.put("x", "shopee_secret", "valor-secreto-de-teste-1234");
    const forged = await b.rpc("web_save_shopee", { p_app_id: "12345678", p_secret_id: idA, p_last4: "1234" });
    expect(forged.error?.code).toBe("42501");
    const wrongUse = await a.rpc("web_save_channel", { p_secret_id: idA, p_bot_name: "@x" });
    expect(wrongUse.error?.code).toBe("42501");
  });
});
