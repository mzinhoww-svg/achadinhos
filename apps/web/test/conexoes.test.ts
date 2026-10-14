import { describe, expect, it } from "vitest";
import { getConnections, saveShopee, saveTelegram, setGroupActive } from "@/server/connections";
import { SECRET_CANARY, TOKEN_CANARY, build } from "./helpers";

const deps = (b: ReturnType<typeof build>) => ({ repo: b.connections, vault: b.vault, telegram: b.telegram });

describe("T8-02 Conexões Shopee (write-only)", () => {
  it("guarda o Secret no cofre e devolve só status e 4 últimos", async () => {
    const b = build();
    const out = await saveShopee(deps(b), { accountId: "acc_A", userId: "u" }, { appId: "18350000042", secret: SECRET_CANARY });
    expect(out.status).toBe("pending_validation");
    expect(out.secretLast4).toBe(SECRET_CANARY.slice(-4));
    expect(JSON.stringify(out)).not.toContain(SECRET_CANARY);
    const rec = await b.connections.getShopee("acc_A");
    expect(JSON.stringify(rec)).not.toContain(SECRET_CANARY); // tabela só tem secret_id
    expect([...b.vault.stored.values()].join()).toContain(SECRET_CANARY);
  });
  it("valida entrada com zod (campos vazios e curtos)", async () => {
    const b = build();
    await expect(saveShopee(deps(b), { accountId: "acc_A", userId: "u" }, { appId: "", secret: "abc" })).rejects.toMatchObject({
      code: "invalid",
      fieldErrors: expect.objectContaining({ appId: expect.any(String), secret: expect.any(String) }),
    });
  });
  it("substituir troca o secret_id e volta a pending_validation", async () => {
    const b = build();
    const s = { accountId: "acc_A", userId: "u" };
    await saveShopee(deps(b), s, { appId: "18350000042", secret: SECRET_CANARY });
    const first = (await b.connections.getShopee("acc_A"))!.secretId;
    await saveShopee(deps(b), s, { appId: "18350000042", secret: `${SECRET_CANARY}-novo` });
    expect((await b.connections.getShopee("acc_A"))!.secretId).not.toBe(first);
  });
  it("conta B não enxerga a credencial da conta A", async () => {
    const b = build();
    await saveShopee(deps(b), { accountId: "acc_A", userId: "u" }, { appId: "18350000042", secret: SECRET_CANARY });
    const view = await getConnections(deps(b), { accountId: "acc_B", userId: "u" });
    expect(view.shopee).toBeNull();
  });
});

describe("T8-03 Conexões Telegram", () => {
  it("token write-only; lista só group/supergroup/channel; sub_id único; inicia inativo", async () => {
    const b = build();
    const s = { accountId: "acc_A", userId: "u" };
    const out = await saveTelegram(deps(b), s, { token: TOKEN_CANARY });
    expect(out.botName).toBe("@achadinhos_teste_bot");
    expect(JSON.stringify(out)).not.toContain(TOKEN_CANARY);
    expect(out.groups.map((g) => g.name)).toEqual(["Grupo Tech", "Canal Casa"]);
    expect(new Set(out.groups.map((g) => g.subId)).size).toBe(2);
    expect(out.groups.every((g) => g.active === false)).toBe(true);
  });
  it("token inválido: erro saneado, nada gravado", async () => {
    const b = build();
    const bad = "9999999999:AAH-CANARY-invalido_000000000000000000";
    const err = await saveTelegram(deps(b), { accountId: "acc_A", userId: "u" }, { token: bad }).catch((e) => e);
    expect(err).toMatchObject({ code: "upstream" });
    expect(String(err.message)).not.toContain(bad);
    expect(b.vault.stored.size).toBe(0);
    expect(await b.connections.getChannel("acc_A")).toBeNull();
  });
  it("ativar/desativar só no próprio grupo", async () => {
    const b = build();
    const a = { accountId: "acc_A", userId: "u" };
    const out = await saveTelegram(deps(b), a, { token: TOKEN_CANARY });
    const g = out.groups[0]!;
    expect((await setGroupActive(deps(b), a, { groupId: g.id, active: true })).active).toBe(true);
    await expect(setGroupActive(deps(b), { accountId: "acc_B", userId: "u" }, { groupId: g.id, active: false })).rejects.toMatchObject({ code: "not_found" });
    expect((await b.connections.listGroups("acc_A"))[0]!.active).toBe(true);
  });
  it("recarregar a lista preserva active e sub_id", async () => {
    const b = build();
    const a = { accountId: "acc_A", userId: "u" };
    const first = await saveTelegram(deps(b), a, { token: TOKEN_CANARY });
    await setGroupActive(deps(b), a, { groupId: first.groups[0]!.id, active: true });
    const again = await saveTelegram(deps(b), a, { token: TOKEN_CANARY });
    expect(again.groups[0]).toMatchObject({ id: first.groups[0]!.id, subId: first.groups[0]!.subId, active: true });
  });
});

describe("Farol R2 — last_error saneado e limitado na leitura", () => {
  it("getConnections redige token e corta em 300 caracteres", async () => {
    const b = build();
    await b.connections.saveShopee({
      accountId: "acc_A", appId: "18350000042", secretId: "v1", secretLast4: "0042", status: "invalid", validatedAt: null,
      lastError: `falhou com bot${TOKEN_CANARY} ${"x".repeat(500)}`,
    });
    const view = await getConnections(deps(b), { accountId: "acc_A", userId: "u" });
    expect(view.shopee!.lastError).not.toContain(TOKEN_CANARY);
    expect(view.shopee!.lastError!.length).toBeLessThanOrEqual(300);
  });
});
