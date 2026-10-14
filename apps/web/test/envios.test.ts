import { describe, expect, it } from "vitest";
import { getEnvios } from "@/server/envios";
import { MemoryConnections } from "@/server/memory";
import { MemorySendNow } from "@/server/memory-sends";
import { guarded } from "@/server/session";
import { sessionOf } from "./helpers";
import { CANDIDATES } from "./send-helpers";

// 14/10/2026 12:00 em Cuiabá (UTC-4) = 16:00Z
const NOW = new Date("2026-10-14T16:00:00Z");
const S = { accountId: "acc_A", userId: "u" };
const DAY = 86_400_000;

async function world() {
  const connections = new MemoryConnections();
  const sends = new MemorySendNow(connections, () => NOW);
  const gA = await connections.syncGroups("acc_A", [{ chatId: "-1", name: "Grupo Tech", chatType: "supergroup", members: 1 }, { chatId: "-2", name: "Canal Casa", chatType: "channel", members: 1 }]);
  const gB = await connections.syncGroups("acc_B", [{ chatId: "-9", name: "Grupo do vizinho", chatType: "supergroup", members: 1 }]);
  for (const g of [...gA, ...gB]) await connections.setGroupActive(g.accountId, g.id, true);
  const offA = await sends.saveOffer("acc_A", CANDIDATES[0]!);
  const offB = await sends.saveOffer("acc_B", CANDIDATES[1]!);
  return { connections, sends, gA, gB, offA, offB, deps: { sends, now: () => NOW } };
}
const at = (iso: string) => new Date(iso);

describe("T8-07 cards do dia e lista de 30 dias", () => {
  it("conta o dia pelo fuso da conta (Cuiabá), não por UTC", async () => {
    const w = await world();
    // 23:30 de 13/10 em Cuiabá = 03:30Z de 14/10 → ainda é "ontem" local
    w.sends.seed({ accountId: "acc_A", groupId: w.gA[0]!.id, offerId: w.offA, status: "sent", at: at("2026-10-14T03:30:00Z") });
    // 00:10 de 14/10 em Cuiabá = 04:10Z → hoje
    w.sends.seed({ accountId: "acc_A", groupId: w.gA[0]!.id, offerId: w.offA, status: "sent", at: at("2026-10-14T04:10:00Z") });
    w.sends.seed({ accountId: "acc_A", groupId: w.gA[0]!.id, offerId: w.offA, status: "failed", reason: "Telegram: bot removido do grupo", at: at("2026-10-14T13:00:00Z") });
    w.sends.seed({ accountId: "acc_A", groupId: w.gA[1]!.id, offerId: w.offA, status: "queued", at: at("2026-10-14T15:55:00Z") });
    w.sends.seed({ accountId: "acc_A", groupId: w.gA[1]!.id, offerId: w.offA, status: "skipped", reason: "teto diário do canal atingido", at: at("2026-10-14T14:00:00Z") });
    const r = await getEnvios(w.deps, S, {});
    expect(r.today).toMatchObject({ sent: 1, failed: 1, skipped: 1, queued: 1 });
    expect(r.items).toHaveLength(5);
    expect(r.items[0]!.status).toBe("queued"); // mais recente primeiro
  });
  it("lista só os últimos 30 dias", async () => {
    const w = await world();
    w.sends.seed({ accountId: "acc_A", groupId: w.gA[0]!.id, offerId: w.offA, status: "sent", at: new Date(NOW.getTime() - 29 * DAY) });
    w.sends.seed({ accountId: "acc_A", groupId: w.gA[0]!.id, offerId: w.offA, status: "sent", at: new Date(NOW.getTime() - 31 * DAY) });
    expect((await getEnvios(w.deps, S, {})).items).toHaveLength(1);
  });
  it("fila não some quando é de outro dia (card Na fila é do agora)", async () => {
    const w = await world();
    w.sends.seed({ accountId: "acc_A", groupId: w.gA[0]!.id, offerId: w.offA, status: "queued", at: new Date(NOW.getTime() - 2 * DAY) });
    expect((await getEnvios(w.deps, S, {})).today.queued).toBe(1);
  });
  it("filtra por status e por grupo; filtro inválido cai no padrão", async () => {
    const w = await world();
    w.sends.seed({ accountId: "acc_A", groupId: w.gA[0]!.id, offerId: w.offA, status: "sent", at: at("2026-10-14T13:00:00Z") });
    w.sends.seed({ accountId: "acc_A", groupId: w.gA[1]!.id, offerId: w.offA, status: "failed", at: at("2026-10-14T13:01:00Z") });
    expect((await getEnvios(w.deps, S, { status: "failed" })).items.map((i) => i.status)).toEqual(["failed"]);
    expect((await getEnvios(w.deps, S, { groupId: w.gA[0]!.id })).items).toHaveLength(1);
    const bad = await getEnvios(w.deps, S, { status: "'; drop table sends;--", groupId: "x".repeat(500) });
    expect(bad.filter).toEqual({ status: "all", groupId: null });
    expect(bad.items).toHaveLength(2);
  });
  it("não vaza dados de outra conta", async () => {
    const w = await world();
    w.sends.seed({ accountId: "acc_B", groupId: w.gB[0]!.id, offerId: w.offB, status: "sent", at: at("2026-10-14T13:00:00Z") });
    const r = await getEnvios(w.deps, S, {});
    expect(r.items).toHaveLength(0);
    expect(r.today.sent).toBe(0);
    expect((await getEnvios(w.deps, S, { groupId: w.gB[0]!.id })).items).toHaveLength(0);
  });
  it("campos públicos: título como texto, motivo saneado, sem ids internos de mensagem", async () => {
    const w = await world();
    w.sends.seed({ accountId: "acc_A", groupId: w.gA[0]!.id, offerId: w.offA, status: "failed", reason: "falhou bot7123456789:AAH-CANARY-token_b0t_9f3a7c1d5e2b4a6c", at: at("2026-10-14T13:00:00Z") });
    const [it] = (await getEnvios(w.deps, S, {})).items;
    expect(it!.offerTitle).toContain("<script>");
    expect(it!.groupName).toBe("Grupo Tech");
    expect(JSON.stringify(it)).not.toContain("CANARY");
    expect(Object.keys(it!)).not.toContain("accountId");
  });
  it("envio manual aparece como origem 'Manual'; automação pelo nome", async () => {
    const w = await world();
    w.sends.seed({ accountId: "acc_A", groupId: w.gA[0]!.id, offerId: w.offA, status: "sent", priority: 100, at: at("2026-10-14T13:00:00Z") });
    w.sends.seed({ accountId: "acc_A", groupId: w.gA[0]!.id, offerId: w.offA, status: "sent", automationName: "Eletrônicos", at: at("2026-10-14T12:00:00Z") });
    expect((await getEnvios(w.deps, S, {})).items.map((i) => i.origin)).toEqual(["Manual", "Eletrônicos"]);
  });
  it("guarda: sem sessão ou account_id forjado é recusado", async () => {
    const w = await world();
    const run = (a: string | null) => guarded(sessionOf(a), (s, i: unknown) => getEnvios(w.deps, s, i))({});
    expect(await run(null)).toMatchObject({ ok: false, code: "unauthorized" });
    const forged = await guarded(sessionOf("acc_A"), (s, i: unknown) => getEnvios(w.deps, s, i))({ account_id: "acc_B" });
    expect(forged).toMatchObject({ ok: false, code: "forbidden" });
  });
  it("estado vazio: zeros e lista vazia", async () => {
    const w = await world();
    const r = await getEnvios(w.deps, S, {});
    expect(r.today).toEqual({ sent: 0, queued: 0, failed: 0, skipped: 0 });
    expect(r.items).toEqual([]);
  });
});
