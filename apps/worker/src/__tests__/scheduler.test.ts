import { describe, expect, it } from "vitest";
import { createClock } from "@achadinhos/domain";
import { runSchedulerTick } from "../scheduler.js";
import { MemoryStore } from "../memory-store.js";
import type { OfferSelector } from "../ports.js";
import { CUIABA, node } from "./helpers.js";

const picks: OfferSelector = async () => ({ kind: "offer", offer: node() });
const none: OfferSelector = async () => ({ kind: "none", reason: "sem_oferta" });

function setup(opts: { nowIso: string; next?: string | null; days?: number[]; start?: string; end?: string; freq?: 15 | 30 | 60 }) {
  const store = new MemoryStore();
  store.addAutomation({
    id: "a1",
    accountId: "acc",
    status: "active",
    days: opts.days ?? [0, 1, 2, 3, 4, 5, 6],
    windowStart: opts.start ?? "08:00",
    windowEnd: opts.end ?? "20:00",
    frequencyMin: opts.freq ?? 30,
    filters: {},
    timezone: CUIABA,
  });
  store.addGroup({
    automationId: "a1",
    groupId: "g1",
    accountId: "acc",
    channelId: "c1",
    active: true,
    nextRunAt: opts.next === undefined ? new Date(opts.nowIso) : opts.next === null ? null : new Date(opts.next),
  });
  const clock = createClock(new Date(opts.nowIso));
  return { store, clock };
}

const tick = (s: ReturnType<typeof setup>, selector: OfferSelector = picks) =>
  runSchedulerTick({ store: s.store, now: s.clock.now, selectOffer: selector, dedupeDays: 7 });

describe("T7-04 agendador", () => {
  it("grupo vencido dentro da janela vira 1 send queued e next_run_at avança estritamente após now", async () => {
    // 12:00 Cuiabá = 16:00Z, em cima da fronteira do slot de 30 min
    const s = setup({ nowIso: "2026-10-13T16:00:00Z" });
    await tick(s);
    expect(s.store.sends).toHaveLength(1);
    const send = s.store.sends[0]!;
    expect(send.status).toBe("queued");
    expect(send.channelId).toBe("c1");
    expect(send.idempotencyKey).toBe("a1:g1:2026-10-13T16:00:00.000Z");
    expect(send.scheduledFor.toISOString()).toBe("2026-10-13T16:00:00.000Z");
    expect(s.store.group("a1", "g1").nextRunAt!.toISOString()).toBe("2026-10-13T16:30:00.000Z");
  });

  it("reexecutar o tick 2x não duplica", async () => {
    const s = setup({ nowIso: "2026-10-13T16:00:00Z" });
    await tick(s);
    await tick(s);
    expect(s.store.sends).toHaveLength(1);
  });

  it("dois workers no mesmo instante geram 1 send (SKIP LOCKED)", async () => {
    const s = setup({ nowIso: "2026-10-13T16:00:00Z" });
    const r = await Promise.all([tick(s), tick(s)]);
    expect(s.store.sends).toHaveLength(1);
    expect(r.map((x) => x.enqueued).sort()).toEqual([0, 1]);
    expect(r.reduce((n, x) => n + x.contended, 0)).toBe(1);
    expect(r.reduce((n, x) => n + x.errors, 0)).toBe(0);
  });

  it("chave de slot já existente não duplica, mas o grupo avança", async () => {
    const s = setup({ nowIso: "2026-10-13T16:00:00Z" });
    s.store.seedSend({ accountId: "acc", idempotencyKey: "a1:g1:2026-10-13T16:00:00.000Z", status: "sent", groupId: "g1", channelId: "c1", automationId: "x" });
    const r = await tick(s);
    expect(s.store.sends).toHaveLength(1);
    expect(r.enqueued).toBe(0);
    expect(s.store.group("a1", "g1").nextRunAt!.toISOString()).toBe("2026-10-13T16:30:00.000Z");
  });

  it("não empilha: já existe queued do mesmo grupo e automação", async () => {
    const s = setup({ nowIso: "2026-10-13T16:00:00Z" });
    s.store.seedSend({ accountId: "acc", idempotencyKey: "velho", status: "queued", groupId: "g1", channelId: "c1", automationId: "a1" });
    await tick(s);
    expect(s.store.sends).toHaveLength(1);
    expect(s.store.group("a1", "g1").nextRunAt!.toISOString()).toBe("2026-10-13T16:30:00.000Z");
  });

  it("borda da janela: 08:00 local entra; 20:00 local (fim exclusivo) não envia mas avança para o dia seguinte", async () => {
    const abre = setup({ nowIso: "2026-10-13T12:00:00Z" }); // 08:00 Cuiabá
    await tick(abre);
    expect(abre.store.sends).toHaveLength(1);

    const fecha = setup({ nowIso: "2026-10-14T00:00:00Z" }); // 20:00 Cuiabá
    await tick(fecha);
    expect(fecha.store.sends).toHaveLength(0);
    // 08:00 de 14/10 em Cuiabá = 12:00Z
    expect(fecha.store.group("a1", "g1").nextRunAt!.toISOString()).toBe("2026-10-14T12:00:00.000Z");
  });

  it("virada de dia: o dia da semana vem do fuso, não do UTC", async () => {
    // 22:30 de terça em Cuiabá = 02:30Z de quarta. Só terça (2) habilitada.
    const ok = setup({ nowIso: "2026-10-14T02:30:00Z", days: [2], start: "22:00", end: "23:59" });
    await tick(ok);
    expect(ok.store.sends).toHaveLength(1);

    // 00:00 de quarta em Cuiabá = 04:00Z: fora de janela e fora do dia.
    const virou = setup({ nowIso: "2026-10-14T04:00:00Z", days: [2], start: "22:00", end: "23:59" });
    await tick(virou);
    expect(virou.store.sends).toHaveLength(0);
    // próximo slot: terça 22:00 Cuiabá = 21/10 02:00Z
    expect(virou.store.group("a1", "g1").nextRunAt!.toISOString()).toBe("2026-10-21T02:00:00.000Z");
  });

  it("janela cruzando 00:00 pertence ao dia de início", async () => {
    // 00:30 de quarta em Cuiabá (04:30Z), janela 22:00–02:00 habilitada só na terça
    const s = setup({ nowIso: "2026-10-14T04:30:00Z", days: [2], start: "22:00", end: "02:00" });
    await tick(s);
    expect(s.store.sends).toHaveLength(1);

    // mesma hora, mas só quarta habilitada: o trecho pós-meia-noite é da terça, não envia
    const n = setup({ nowIso: "2026-10-14T04:30:00Z", days: [3], start: "22:00", end: "02:00" });
    await tick(n);
    expect(n.store.sends).toHaveLength(0);
  });

  it("recuperação após parada: slot de 3 h atrás gera 1 send e pula os slots vencidos", async () => {
    const s = setup({ nowIso: "2026-10-13T16:10:00Z", next: "2026-10-13T13:00:00Z" });
    await tick(s);
    expect(s.store.sends).toHaveLength(1);
    expect(s.store.sends[0]!.idempotencyKey).toBe("a1:g1:2026-10-13T13:00:00.000Z");
    expect(s.store.group("a1", "g1").nextRunAt!.toISOString()).toBe("2026-10-13T16:30:00.000Z");
  });

  it("next_run_at nulo é inicializado sem enviar", async () => {
    const s = setup({ nowIso: "2026-10-13T16:10:00Z", next: null });
    const r = await tick(s);
    expect(s.store.sends).toHaveLength(0);
    expect(r.initialized).toBe(1);
    expect(s.store.group("a1", "g1").nextRunAt!.toISOString()).toBe("2026-10-13T16:30:00.000Z");
  });

  it("grupo ainda não vencido é ignorado", async () => {
    const s = setup({ nowIso: "2026-10-13T16:10:00Z", next: "2026-10-13T16:30:00Z" });
    await tick(s);
    expect(s.store.sends).toHaveLength(0);
    expect(s.store.group("a1", "g1").nextRunAt!.toISOString()).toBe("2026-10-13T16:30:00.000Z");
  });

  it("automação pausada e grupo inativo não são agendados", async () => {
    const p = setup({ nowIso: "2026-10-13T16:00:00Z" });
    p.store.automation("a1").status = "paused";
    await tick(p);
    expect(p.store.sends).toHaveLength(0);

    const i = setup({ nowIso: "2026-10-13T16:00:00Z" });
    i.store.group("a1", "g1").active = false;
    await tick(i);
    expect(i.store.sends).toHaveLength(0);
  });

  it("sem oferta elegível: registra skipped/sem_oferta e avança", async () => {
    const s = setup({ nowIso: "2026-10-13T16:00:00Z" });
    await tick(s, none);
    expect(s.store.sends).toHaveLength(1);
    expect(s.store.sends[0]!.status).toBe("skipped");
    expect(s.store.sends[0]!.reason).toBe("sem_oferta");
    expect(s.store.group("a1", "g1").nextRunAt!.toISOString()).toBe("2026-10-13T16:30:00.000Z");
  });

  it("erro do seletor (Shopee) não envia nem avança, e não derruba os outros grupos", async () => {
    const s = setup({ nowIso: "2026-10-13T16:00:00Z" });
    s.store.addGroup({ automationId: "a1", groupId: "g2", accountId: "acc", channelId: "c2", active: true, nextRunAt: new Date("2026-10-13T16:00:00Z") });
    const flaky: OfferSelector = async (input) => {
      if (input.groupId === "g1") throw new Error("shopee fora");
      return { kind: "offer", offer: node() };
    };
    const r = await tick(s, flaky);
    expect(r.errors).toBe(1);
    expect(s.store.sends.map((x) => x.groupId)).toEqual(["g2"]);
    expect(s.store.group("a1", "g1").nextRunAt!.toISOString()).toBe("2026-10-13T16:00:00.000Z");
  });

  it("insert e avanço são atômicos: falha ao avançar desfaz o send", async () => {
    const s = setup({ nowIso: "2026-10-13T16:00:00Z" });
    s.store.failNextAdvance = true;
    const r = await tick(s);
    expect(r.errors).toBe(1);
    expect(s.store.sends).toHaveLength(0);
    expect(s.store.group("a1", "g1").nextRunAt!.toISOString()).toBe("2026-10-13T16:00:00.000Z");
  });

  it("faz upsert da oferta e o send referencia offer_id", async () => {
    const s = setup({ nowIso: "2026-10-13T16:00:00Z" });
    await tick(s);
    expect(s.store.offers).toHaveLength(1);
    expect((s.store.sends[0] as { offerId: string }).offerId).toBe(s.store.offers[0]!.id);
  });

  it("linha alterada por outro worker durante a seleção: contended, sem send nem avanço próprio", async () => {
    const s = setup({ nowIso: "2026-10-13T16:00:00Z" });
    const racing: OfferSelector = async () => {
      // outro worker já processou e, depois, a linha voltou a ficar vencida com outro slot
      s.store.group("a1", "g1").nextRunAt = new Date("2026-10-13T15:00:00Z");
      return { kind: "offer", offer: node() };
    };
    const r = await tick(s, racing);
    expect(r.contended).toBe(1);
    expect(s.store.sends).toHaveLength(0);
    expect(s.store.group("a1", "g1").nextRunAt!.toISOString()).toBe("2026-10-13T15:00:00.000Z");
  });
});
