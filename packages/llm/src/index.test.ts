import { describe, expect, it } from "vitest";
import { type ChamadaRegistrada, criarClienteLlm } from "./index.js";

function resposta(status: number, corpo: unknown) {
  return new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
}

describe("cliente LLM", () => {
  it("usa o modelo da tarefa e registra o custo", async () => {
    const chamadas: ChamadaRegistrada[] = [];
    let corpoEnviado: { model?: string } = {};
    const llm = criarClienteLlm({
      apiKey: "k",
      modelos: { copy: { principal: "a/modelo", reserva: "b/reserva" } },
      registrar: (c) => {
        chamadas.push(c);
      },
      fetch: (async (_url: string, init: RequestInit) => {
        corpoEnviado = JSON.parse(String(init.body));
        return resposta(200, {
          choices: [{ message: { content: "olá" } }],
          usage: { prompt_tokens: 3, completion_tokens: 1, cost: 0.0001 },
        });
      }) as typeof fetch,
    });
    const r = await llm.conversar({
      tarefa: "copy",
      mensagens: [{ role: "user", content: "oi" }],
      chaveIdempotente: "x1",
      agente: "Copywriter",
    });
    expect(corpoEnviado.model).toBe("a/modelo");
    expect(r).toMatchObject({ texto: "olá", usouReserva: false, custoUsd: 0.0001 });
    expect(chamadas).toEqual([
      expect.objectContaining({ chaveIdempotente: "x1:principal", sucesso: true, custoUsd: 0.0001 }),
    ]);
  });

  it("cai para o reserva em erro recuperável", async () => {
    const modelos: string[] = [];
    const llm = criarClienteLlm({
      apiKey: "k",
      modelos: { copy: { principal: "a", reserva: "b" } },
      fetch: (async (_u: string, init: RequestInit) => {
        const m = JSON.parse(String(init.body)).model as string;
        modelos.push(m);
        return m === "a"
          ? resposta(503, { error: { message: "fora" } })
          : resposta(200, { choices: [{ message: { content: "ok" } }] });
      }) as typeof fetch,
    });
    const r = await llm.conversar({ tarefa: "copy", mensagens: [], chaveIdempotente: "x2" });
    expect(modelos).toEqual(["a", "b"]);
    expect(r.usouReserva).toBe(true);
  });

  it("não tenta o reserva em erro de requisição (4xx)", async () => {
    const llm = criarClienteLlm({
      apiKey: "k",
      modelos: { copy: { principal: "a", reserva: "b" } },
      fetch: (async () => resposta(400, { error: { message: "ruim" } })) as unknown as typeof fetch,
    });
    await expect(llm.conversar({ tarefa: "copy", mensagens: [], chaveIdempotente: "x3" })).rejects.toThrow(
      "ruim",
    );
  });

  it("recusa tarefa sem modelo", async () => {
    const llm = criarClienteLlm({ apiKey: "k", modelos: {} });
    await expect(llm.conversar({ tarefa: "x", mensagens: [], chaveIdempotente: "x4" })).rejects.toThrow(
      /sem modelo/,
    );
  });
});
