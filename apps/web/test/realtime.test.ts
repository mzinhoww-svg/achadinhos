import { describe, expect, it, vi } from "vitest";
import { applySendChange, subscribeSends, type SendChange } from "@/lib/realtime";
import type { PublicSend } from "@/lib/envios-view";

const item = (o: Partial<PublicSend> = {}): PublicSend => ({
  id: "s1", status: "queued", reason: null, origin: "Manual", offerTitle: "Fone", groupName: "Grupo Tech",
  at: "2026-10-14T15:00:00.000Z", shortLink: null, ...o,
});
const change = (o: Partial<SendChange> = {}): SendChange => ({ id: "s1", accountId: "acc_A", status: "sent", reason: null, sentAt: "2026-10-14T15:01:00.000Z", ...o });

describe("T8-07 reducer de eventos", () => {
  it("atualiza status/horário do envio conhecido, sem recarregar", () => {
    const r = applySendChange([item()], change(), "acc_A");
    expect(r.items[0]).toMatchObject({ status: "sent", at: "2026-10-14T15:01:00.000Z" });
    expect(r.refresh).toBe(false);
  });
  it("evento de outra conta é ignorado", () => {
    const r = applySendChange([item()], change({ accountId: "acc_B" }), "acc_A");
    expect(r.items[0]!.status).toBe("queued");
    expect(r.refresh).toBe(false);
  });
  it("envio desconhecido pede refresh (precisa de oferta/grupo do servidor)", () => {
    const r = applySendChange([item()], change({ id: "novo" }), "acc_A");
    expect(r.refresh).toBe(true);
    expect(r.items).toHaveLength(1);
  });
  it("não regride estado final (sent → queued é ignorado)", () => {
    const r = applySendChange([item({ status: "sent" })], change({ status: "queued" }), "acc_A");
    expect(r.items[0]!.status).toBe("sent");
  });
  it("motivo é saneado (token nunca aparece)", () => {
    const r = applySendChange([item()], change({ status: "failed", reason: "erro bot7123456789:AAH-CANARY-token_b0t_9f3a7c1d5e2b4a6c" }), "acc_A");
    expect(JSON.stringify(r.items)).not.toContain("CANARY");
  });
});

function fakeSupabase() {
  const handlers: Array<(p: unknown) => void> = [];
  const state = { name: "", filter: null as unknown, removed: false, statusCb: null as null | ((s: string) => void) };
  const channel = {
    on(_type: string, filter: unknown, cb: (p: unknown) => void) { state.filter = filter; handlers.push(cb); return channel; },
    subscribe(cb?: (s: string) => void) { state.statusCb = cb ?? null; return channel; },
  };
  const client = {
    channel(name: string) { state.name = name; return channel; },
    removeChannel: vi.fn(async () => { state.removed = true; return "ok"; }),
  };
  return { client, state, emit: (p: unknown) => handlers.forEach((h) => h(p)) };
}

describe("T8-07 assinatura Realtime (sob RLS)", () => {
  it("assina só `sends` da conta e entrega eventos traduzidos", () => {
    const f = fakeSupabase();
    const got: SendChange[] = [];
    subscribeSends(f.client, "acc_A", (c) => got.push(c));
    expect(f.state.filter).toMatchObject({ event: "*", schema: "public", table: "sends", filter: "account_id=eq.acc_A" });
    f.emit({ eventType: "UPDATE", new: { id: "s1", account_id: "acc_A", status: "sent", reason: null, sent_at: "2026-10-14T15:01:00Z", external_message_id: "999" } });
    expect(got).toEqual([{ id: "s1", accountId: "acc_A", status: "sent", reason: null, sentAt: "2026-10-14T15:01:00Z" }]);
    expect(JSON.stringify(got)).not.toContain("999");
  });
  it("ignora payload malformado e evento de outra conta", () => {
    const f = fakeSupabase();
    const got: SendChange[] = [];
    subscribeSends(f.client, "acc_A", (c) => got.push(c));
    f.emit({ eventType: "UPDATE", new: { id: 5 } });
    f.emit(null);
    f.emit({ eventType: "UPDATE", new: { id: "s1", account_id: "acc_B", status: "sent" } });
    f.emit({ eventType: "DELETE", old: { id: "s1" } });
    expect(got).toEqual([]);
  });
  it("cancelar a assinatura remove o canal", async () => {
    const f = fakeSupabase();
    const off = subscribeSends(f.client, "acc_A", () => {});
    off();
    expect(f.client.removeChannel).toHaveBeenCalledTimes(1);
  });
  it("reporta estado da conexão", () => {
    const f = fakeSupabase();
    const states: string[] = [];
    subscribeSends(f.client, "acc_A", () => {}, (s) => states.push(s));
    f.state.statusCb?.("SUBSCRIBED");
    f.state.statusCb?.("CHANNEL_ERROR");
    expect(states).toEqual(["live", "reconnecting"]);
  });
});
