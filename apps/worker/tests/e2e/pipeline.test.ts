import { afterEach, describe, expect, it } from "vitest";
import { createWorld } from "./world.js";

let world: Awaited<ReturnType<typeof createWorld>> | undefined;
afterEach(async () => {
  await world?.close();
  world = undefined;
});

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];

describe("e2e (portas em memória + Shopee/Telegram simulados)", () => {
  it("automação -> oferta -> link curto com subIds -> criativo -> sendPhoto -> sent", async () => {
    // 2026-10-13 12:00 em Cuiabá (UTC-4), dentro da janela 08:00–20:00
    world = await createWorld("2026-10-13T16:00:00Z");
    await world.runtime.tickOnce();
    expect(world.store.sends).toHaveLength(1);
    expect(world.store.sends[0]).toMatchObject({ status: "queued", channelId: "c1" });
    expect(world.store.offers).toHaveLength(1);

    await world.runtime.executorOnce();
    const send = world.store.sends[0]!;
    expect(send.status).toBe("sent");

    // subIds: [conta, automação, sub_id do grupo, canal, envio]
    expect(world.subIds).toEqual([["acc1", "au1", "g7", "c1", send.id]]);

    // criativo PNG real gravado e enviado por URL assinada
    expect(world.storedPngs).toHaveLength(1);
    expect([...world.storedPngs[0]!.slice(0, 4)]).toEqual(PNG_MAGIC);
    expect(world.storedPngs[0]!.length).toBeGreaterThan(1_000);

    const [msg] = world.sentMessages();
    expect(msg!.params.photo).toBe(`https://signed.example/${send.id}?t=x`);
    expect(String(msg!.params.caption)).toContain("https://shope.ee/mockshort1");

    const res = world.queue.results.get(send.id);
    expect(res).toMatchObject({ status: "sent", shortLink: "https://shope.ee/mockshort1", creativeUrl: `creatives/${send.id}.png` });
    expect(world.runtime.heartbeat().lastBeatAt).not.toBeNull();
  });

  it("reexecução 2x (tick e executor) não duplica envio", async () => {
    world = await createWorld("2026-10-13T16:00:00Z");
    for (let i = 0; i < 2; i++) {
      await world.runtime.tickOnce();
      await world.runtime.executorOnce();
    }
    // mesmo slot/mesma chave: segundo tick não cria outro, segundo executor não reclama nada
    expect(world.store.sends.filter((s) => s.status === "sent")).toHaveLength(1);
    expect(world.sentMessages()).toHaveLength(1);

    // dois executores concorrentes sobre o mesmo canal: no máximo um claim
    await world.enqueueDirect("au1:g1:extra-1", world.clock.now());
    await Promise.all([world.runtime.executorOnce(), world.runtime.executorOnce()]);
    expect(world.sentMessages()).toHaveLength(1); // ainda dentro dos 60 s
  });

  it("intervalo de 60 s entre envios do mesmo canal: 59 s nega, 60 s libera", async () => {
    world = await createWorld("2026-10-13T16:00:00Z");
    await world.enqueueDirect("k1", new Date("2026-10-13T16:00:00Z"));
    await world.enqueueDirect("k2", new Date("2026-10-13T16:00:01Z"));
    await world.runtime.executorOnce();
    expect(world.sentMessages()).toHaveLength(1);
    world.clock.advance(59_000);
    await world.runtime.executorOnce();
    expect(world.sentMessages()).toHaveLength(1);
    world.clock.advance(1_000);
    await world.runtime.executorOnce();
    expect(world.sentMessages()).toHaveLength(2);
  });

  it("teto de 200/dia no fuso de Cuiabá: bloqueia em 23:59:30 e libera em 00:00:30 local", async () => {
    world = await createWorld("2026-10-14T02:00:00Z", { window: ["00:00", "23:59"] }); // 22:00 local de 13/10
    world.queue.seedAttempts("c1", 200, new Date("2026-10-14T00:00:00Z")); // 20:00 local de 13/10
    await world.enqueueDirect("cap", new Date("2026-10-14T02:00:00Z"));
    world.clock.set(new Date("2026-10-14T03:59:30Z")); // 23:59:30 local
    await world.runtime.executorOnce();
    expect(world.sentMessages()).toHaveLength(0);
    expect(world.store.sends[0]!.status).toBe("queued");
    world.clock.set(new Date("2026-10-14T04:00:30Z")); // 00:00:30 local do dia 14
    await world.runtime.executorOnce();
    expect(world.sentMessages()).toHaveLength(1);
  });

  it("janela: queued que só é reclamado depois do fim vira skipped/fora_da_janela e não envia", async () => {
    world = await createWorld("2026-10-13T23:59:00Z"); // 19:59 local, janela até 20:00
    await world.enqueueDirect("late", new Date("2026-10-13T23:59:00Z"));
    world.clock.set(new Date("2026-10-14T00:01:00Z")); // 20:01 local
    await world.runtime.executorOnce();
    expect(world.sentMessages()).toHaveLength(0);
    expect(world.store.sends[0]).toMatchObject({ status: "skipped", reason: "fora_da_janela" });
  });

  it("virada de dia com janela 22:00–02:00: agenda antes e depois da meia-noite local, 1 envio por slot", async () => {
    world = await createWorld("2026-10-14T03:30:00Z", { window: ["22:00", "02:00"], nextRunAt: "2026-10-14T03:30:00Z" }); // 23:30 local
    await world.runtime.tickOnce();
    await world.runtime.executorOnce();
    expect(world.sentMessages()).toHaveLength(1);

    world.clock.set(new Date("2026-10-14T04:30:00Z")); // 00:30 local do dia 14
    await world.runtime.tickOnce();
    await world.runtime.tickOnce(); // repetido
    await world.runtime.executorOnce();
    // a única oferta do fixture já foi enviada há < 7 dias: a decisão pós-meia-noite é skipped/repetida
    expect(world.sentMessages()).toHaveLength(1);
    expect(world.store.sends).toHaveLength(2);
    expect(world.store.sends.map((x) => x.status).sort()).toEqual(["sent", "skipped"]);
    expect(world.store.sends.find((x) => x.status === "skipped")!.reason).toBe("repetida");
    expect(new Set(world.store.sends.map((x) => x.idempotencyKey)).size).toBe(2);
    // o slot depois da meia-noite local é outro slot (chave distinta), não repetição do anterior
    expect(world.store.sends.map((x) => x.scheduledFor.toISOString()).sort()).toEqual([
      "2026-10-14T03:00:00.000Z",
      "2026-10-14T04:00:00.000Z",
    ]);
  });

  it("falha de Telegram sem acesso gera alerta e não reenvia", async () => {
    world = await createWorld("2026-10-13T16:00:00Z");
    world.tg.setChatAccess(-100123, false);
    await world.runtime.tickOnce();
    await world.runtime.executorOnce();
    expect(world.store.sends[0]).toMatchObject({ status: "failed" });
    expect(world.alerts.getHistory().map((h) => h.cause)).toEqual(["telegram_bot_lost_access"]);
    expect(world.sentMessages()).toHaveLength(0);
  });
});
