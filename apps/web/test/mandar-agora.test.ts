import { describe, expect, it } from "vitest";
import { parseOfferInput, previewOffer, searchOffers, sendNow } from "@/server/send-now";
import { guarded } from "@/server/session";
import { SECRET_CANARY, sessionOf } from "./helpers";
import { buildSend } from "./send-helpers";

const S = { accountId: "acc_A", userId: "u_acc_A" };

describe("T8-06 entrada: palavra-chave ou URL", () => {
  it("classifica palavra-chave e URL da Shopee", () => {
    expect(parseOfferInput("  fone bluetooth ")).toEqual({ kind: "keyword", keyword: "fone bluetooth" });
    expect(parseOfferInput("https://shopee.com.br/product/10/1001")).toEqual({ kind: "item", itemId: "1001" });
    expect(parseOfferInput("https://shopee.com.br/Fone-Bluetooth-i.10.1001?sp_atk=x")).toEqual({ kind: "item", itemId: "1001" });
    expect(parseOfferInput("https://s.shopee.com.br/AbCd12")).toEqual({ kind: "short", url: "https://s.shopee.com.br/AbCd12" });
    expect(parseOfferInput("https://shope.ee/xyz")).toMatchObject({ kind: "short" });
  });
  it.each([
    "http://shopee.com.br/product/10/1001",
    "https://evil.example/product/10/1001",
    "https://shopee.com.br.evil.example/product/10/1001",
    "https://evilshopee.com.br/product/10/1001",
    "https://shopee.com.br@evil.example/product/10/1001",
    "javascript:alert(1)",
    "ftp://shopee.com.br/x",
  ])("recusa URL fora da allowlist: %s", (u) => {
    expect(parseOfferInput(u)).toEqual({ kind: "invalid", message: expect.any(String) });
  });
  it.each(["", " ", "a", "x".repeat(81)])("recusa palavra-chave inválida (%j)", (k) => {
    expect(parseOfferInput(k).kind).toBe("invalid");
  });
});

describe("T8-06 busca e prévia", () => {
  it("devolve só campos públicos (sem links de afiliado nem dados brutos)", async () => {
    const { deps } = await buildSend();
    const r = await searchOffers(deps, S, { q: "fone" });
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ itemId: "1001", price: 99.9, oldPrice: 189.9, discountPct: 47 });
    expect(JSON.stringify(r)).not.toContain("aff=1");
    expect(Object.keys(r[0]!)).not.toContain("offerLink");
  });
  it("descarta candidato com imagem ou link fora de https", async () => {
    const { deps, finder } = await buildSend();
    finder.search = async () => [
      { ...(await finder.byItemId("a", "1001"))!, itemId: "9", imageUrl: "http://x/a.jpg" },
      { ...(await finder.byItemId("a", "1001"))!, itemId: "8", offerLink: "javascript:alert(1)" },
      (await finder.byItemId("a", "1002"))!,
    ];
    const r = await searchOffers(deps, S, { q: "qualquer" });
    expect(r.map((o) => o.itemId)).toEqual(["1002"]);
  });
  it("URL de produto resolve por itemId; link curto pelo resolvedor", async () => {
    const { deps, finder } = await buildSend();
    await searchOffers(deps, S, { q: "https://shopee.com.br/product/10/1002" });
    await searchOffers(deps, S, { q: "https://s.shopee.com.br/AbCd12" });
    expect(finder.calls).toEqual(["item:1002", "short:https://s.shopee.com.br/AbCd12"]);
  });
  it("entrada inválida vira erro de campo, sem chamar a Shopee", async () => {
    const { deps, finder } = await buildSend();
    await expect(searchOffers(deps, S, { q: "https://evil.example/x" })).rejects.toMatchObject({ code: "invalid", fieldErrors: { q: expect.any(String) } });
    expect(finder.calls).toEqual([]);
  });
  it("prévia gera link curto com subIds internos (≤5, sem dado pessoal) e avisa repetição", async () => {
    const { deps, links, sends, groupsA } = await buildSend();
    await sendNow(deps, S, { itemId: "1001", groupIds: [groupsA[0]!.id] });
    sends.markSent("acc_A", groupsA[0]!.id, "1001", new Date("2026-10-12T12:00:00Z"));
    const p = await previewOffer(deps, S, { itemId: "1001", groupIds: [groupsA[0]!.id] });
    expect(p.shortLink).toBe("https://s.shopee.com.br/demo123");
    expect(links.calls[0]!.originUrl).toBe("https://shopee.com.br/product/10/1001?aff=1");
    expect(links.calls[0]!.subIds.length).toBeLessThanOrEqual(5);
    expect(links.calls[0]!.subIds.join(",")).not.toMatch(/@|\s/);
    expect(p.repeats).toEqual([{ groupId: groupsA[0]!.id, daysAgo: 2 }]);
    expect(p.offer.title).toContain("<script>"); // texto cru: a UI renderiza como texto
  });
  it("itemId desconhecido: not_found", async () => {
    const { deps } = await buildSend();
    await expect(previewOffer(deps, S, { itemId: "404404", groupIds: [] })).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("T8-06 mandar agora", () => {
  it("enfileira um envio por grupo com prioridade 100 e status queued", async () => {
    const { deps, sends, groupsA } = await buildSend();
    await deps.connections.setGroupActive("acc_A", groupsA[1]!.id, true);
    const r = await sendNow(deps, S, { itemId: "1001", groupIds: groupsA.map((g) => g.id) });
    expect(r.results.map((x) => x.status)).toEqual(["queued", "queued"]);
    const rows = sends.rows("acc_A");
    expect(rows).toHaveLength(2);
    expect(rows.every((x) => x.status === "queued" && x.priority === 100)).toBe(true);
  });
  it("duplo clique = 1 envio", async () => {
    const { deps, sends, groupsA } = await buildSend();
    const a = await sendNow(deps, S, { itemId: "1001", groupIds: [groupsA[0]!.id] });
    const b = await sendNow(deps, S, { itemId: "1001", groupIds: [groupsA[0]!.id] });
    expect(a.results[0]!.status).toBe("queued");
    expect(b.results[0]).toMatchObject({ status: "already_queued", sendId: a.results[0]!.sendId });
    expect(sends.rows("acc_A")).toHaveLength(1);
  });
  it("campos do cliente além de itemId/groupIds (status, priority) são recusados", async () => {
    const { deps, sends, groupsA } = await buildSend();
    for (const extra of [{ priority: 999 }, { status: "sent" }, { scheduledFor: "2020-01-01" }]) {
      await expect(sendNow(deps, S, { itemId: "1001", groupIds: [groupsA[0]!.id], ...extra })).rejects.toMatchObject({ code: "invalid" });
    }
    expect(sends.rows("acc_A")).toHaveLength(0);
  });
  it("grupo de outra conta: recusa tudo e não enfileira nada", async () => {
    const { deps, sends, groupsA, groupsB } = await buildSend();
    await expect(sendNow(deps, S, { itemId: "1001", groupIds: [groupsA[0]!.id, groupsB[0]!.id] })).rejects.toMatchObject({ code: "not_found" });
    expect(sends.rows("acc_A")).toHaveLength(0);
    expect(sends.rows("acc_B")).toHaveLength(0);
  });
  it("grupo inativo: erro de campo claro", async () => {
    const { deps, groupsA } = await buildSend();
    await expect(sendNow(deps, S, { itemId: "1001", groupIds: [groupsA[1]!.id] })).rejects.toMatchObject({ code: "invalid", fieldErrors: { groupIds: expect.stringContaining("inativo") } });
  });
  it.each([[[]], [Array.from({ length: 21 }, (_, i) => `g${i}`)]])("quantidade de grupos fora de 1..20 é recusada", async (ids) => {
    const { deps } = await buildSend();
    await expect(sendNow(deps, S, { itemId: "1001", groupIds: ids })).rejects.toMatchObject({ code: "invalid" });
  });
  it("sem sessão ou com account_id forjado a guarda recusa antes do handler", async () => {
    const { deps, sends, groupsA } = await buildSend();
    const run = (acc: string | null) => guarded(sessionOf(acc), (s, i: unknown) => sendNow(deps, s, i));
    expect(await run(null)({ itemId: "1001", groupIds: [groupsA[0]!.id] })).toMatchObject({ ok: false, code: "unauthorized" });
    expect(await run("acc_A")({ itemId: "1001", groupIds: [groupsA[0]!.id], account_id: "acc_B" })).toMatchObject({ ok: false, code: "forbidden" });
    expect(sends.rows("acc_A")).toHaveLength(0);
  });
  it("resposta nunca carrega segredo", async () => {
    const { deps, groupsA } = await buildSend();
    const r = await sendNow(deps, S, { itemId: "1001", groupIds: [groupsA[0]!.id] });
    expect(JSON.stringify(r)).not.toContain(SECRET_CANARY);
  });
});
