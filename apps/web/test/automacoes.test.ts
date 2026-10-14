import { describe, expect, it } from "vitest";
import { createAutomation, deleteAutomation, listAutomations, updateAutomation, estimateFor } from "@/server/automations";
import { build } from "./helpers";

const valid = {
  name: "Eletrônicos até R$ 150",
  days: [1, 2, 3, 4, 5],
  windowStart: "08:00",
  windowEnd: "20:00",
  frequencyMin: 30,
  filters: { category: "Eletrônicos", minDiscount: 30 },
  groupIds: [] as string[],
};
const S = { accountId: "acc_A", userId: "u" };

async function seed(b: ReturnType<typeof build>) {
  const gs = await b.connections.syncGroups("acc_A", [
    { chatId: "-1", name: "G1", chatType: "supergroup", members: 1 },
    { chatId: "-2", name: "G2", chatType: "supergroup", members: 1 },
  ]);
  for (const g of gs.slice(0, 1)) await b.connections.setGroupActive("acc_A", g.id, true);
  return gs;
}
const d = (b: ReturnType<typeof build>) => ({ automations: b.automations, connections: b.connections });

describe("T8-04 Automações", () => {
  it("cria com zod e vincula só grupos ativos da própria conta", async () => {
    const b = build();
    const gs = await seed(b);
    const rec = await createAutomation(d(b), S, { ...valid, groupIds: [gs[0]!.id] });
    expect(rec.accountId).toBe("acc_A");
    expect(rec.groupIds).toEqual([gs[0]!.id]);
  });
  it("recusa grupo inativo ou de outra conta", async () => {
    const b = build();
    const gs = await seed(b);
    await expect(createAutomation(d(b), S, { ...valid, groupIds: [gs[1]!.id] })).rejects.toMatchObject({ code: "invalid" });
    await expect(createAutomation(d(b), { accountId: "acc_B", userId: "u" }, { ...valid, groupIds: [gs[0]!.id] })).rejects.toMatchObject({ code: "invalid" });
  });
  it("valida janela, dias e frequência", async () => {
    const b = build();
    for (const bad of [{ windowStart: "25:00" }, { days: [] }, { frequencyMin: 45 }, { name: "" }, { windowEnd: "08:00" }]) {
      await expect(createAutomation(d(b), S, { ...valid, ...bad })).rejects.toMatchObject({ code: "invalid" });
    }
  });
  it("6ª automação é recusada com mensagem clara, mesmo em criação concorrente", async () => {
    const b = build();
    const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => createAutomation(d(b), S, { ...valid, name: `A${i}` })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(5);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "limit" });
    expect(String(rejected.reason.message)).toMatch(/5 automações/);
  });
  it("editar a 5ª não conta como nova", async () => {
    const b = build();
    const made = [];
    for (let i = 0; i < 5; i++) made.push(await createAutomation(d(b), S, { ...valid, name: `A${i}` }));
    const upd = await updateAutomation(d(b), S, { id: made[4]!.id, ...valid, name: "Renomeada" });
    expect(upd.name).toBe("Renomeada");
  });
  it("isolamento: B não lista, edita nem apaga as de A", async () => {
    const b = build();
    const a = await createAutomation(d(b), S, valid);
    const B = { accountId: "acc_B", userId: "u" };
    expect(await listAutomations(d(b), B)).toEqual([]);
    await expect(updateAutomation(d(b), B, { id: a.id, ...valid })).rejects.toMatchObject({ code: "not_found" });
    await expect(deleteAutomation(d(b), B, { id: a.id })).rejects.toMatchObject({ code: "not_found" });
    expect(await listAutomations(d(b), S)).toHaveLength(1);
  });
  it("conteúdo com HTML é guardado como texto", async () => {
    const b = build();
    const r = await createAutomation(d(b), S, { ...valid, name: "<script>alert(1)</script>" });
    expect(r.name).toBe("<script>alert(1)</script>");
  });
});

describe("T8-05 estimativa (packages/domain)", () => {
  it.each([
    [{ groups: 2, windowStart: "08:00", windowEnd: "20:00", frequencyMin: 30 as const }, 48, false],
    [{ groups: 10, windowStart: "06:00", windowEnd: "23:00", frequencyMin: 15 as const }, 200, true],
    [{ groups: 1, windowStart: "22:00", windowEnd: "02:00", frequencyMin: 60 as const }, 4, false], // cruza a meia-noite
    [{ groups: 3, windowStart: "10:00", windowEnd: "10:00", frequencyMin: 60 as const }, 0, false],
    [{ groups: 0, windowStart: "08:00", windowEnd: "20:00", frequencyMin: 15 as const }, 0, false],
  ])("%o → %i", (input, capped, hitCap) => {
    const r = estimateFor(input);
    expect(r.capped).toBe(capped);
    expect(r.hitCap).toBe(hitCap);
  });
});
