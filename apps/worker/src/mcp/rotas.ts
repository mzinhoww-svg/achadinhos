import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { VERSAO } from "../versao.js";
import { AGENTES, type Agente, ferramentasDe, tokenAgente } from "./ferramentas.js";

/**
 * Servidor MCP (Streamable HTTP, respostas JSON) em POST /mcp. Cada agente se autentica com o próprio token
 * (Authorization: Bearer ach_…) e só vê as ferramentas da sua função. A chamada da ferramenta vira uma requisição
 * interna ao worker com o SERVICE_TOKEN, o header x-origem: openbot (sinal de vida dos agentes) e o nome do agente.
 */
const PROTOCOLO = "2025-06-18";

function igual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function agenteDoToken(serviceToken: string, cabecalho: string | undefined): Agente | null {
  const token = cabecalho?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  return AGENTES.find((a) => igual(token, tokenAgente(serviceToken, a))) ?? null;
}

interface Rpc {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export function rotasMcp(app: FastifyInstance, serviceToken: string, publicUrl: string) {
  /** Lista dos agentes com token e ferramentas, para o painel mostrar a configuração do OpenBot. */
  app.get("/agentes", async () => ({
    mcpUrl: `${publicUrl.replace(/\/$/, "")}/mcp`,
    agentes: AGENTES.map((a) => ({
      nome: a,
      token: tokenAgente(serviceToken, a),
      ferramentas: ferramentasDe(a).map((f) => f.nome),
    })),
  }));

  app.get("/mcp", async (_req, reply) =>
    reply.code(405).header("allow", "POST").send({ erro: "use POST (MCP Streamable HTTP)" }),
  );

  // Token na URL (/mcp/ach_…): para clientes que não deixam o agente gravar cabeçalhos (ex.: OpenBot).
  app.get("/mcp/:token", async (_req, reply) =>
    reply.code(405).header("allow", "POST").send({ erro: "use POST (MCP Streamable HTTP)" }),
  );
  app.post("/mcp/:token", async (req, reply) => {
    const { token } = req.params as { token: string };
    return atender(req.body, `Bearer ${token}`, reply);
  });

  app.post("/mcp", async (req, reply) => atender(req.body, req.headers.authorization, reply));

  async function atender(
    body: unknown,
    cabecalho: string | undefined,
    reply: import("fastify").FastifyReply,
  ) {
    const agente = agenteDoToken(serviceToken, cabecalho);
    if (!agente)
      return reply.code(401).header("www-authenticate", "Bearer").send({ erro: "token de agente inválido" });
    const corpo = body as Rpc | Rpc[];
    const lote = Array.isArray(corpo) ? corpo : [corpo];
    const respostas = [];
    for (const m of lote) {
      const r = await tratar(app, serviceToken, agente, m);
      if (m.id !== undefined && m.id !== null) respostas.push(r);
    }
    if (!respostas.length) return reply.code(202).send();
    return reply
      .header("content-type", "application/json")
      .send(Array.isArray(corpo) ? respostas : respostas[0]);
  }
}

async function tratar(app: FastifyInstance, serviceToken: string, agente: Agente, m: Rpc) {
  const ok = (result: unknown) => ({ jsonrpc: "2.0", id: m.id ?? null, result });
  const erro = (code: number, message: string) => ({
    jsonrpc: "2.0",
    id: m.id ?? null,
    error: { code, message },
  });
  if (m?.jsonrpc !== "2.0" || typeof m.method !== "string")
    return erro(-32600, "requisição JSON-RPC inválida");
  switch (m.method) {
    case "initialize":
      return ok({
        protocolVersion: PROTOCOLO,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "achadinhos-worker", version: VERSAO },
        instructions: `Você é o ${agente} do Achadinhos. Use só estas ferramentas; as regras ficam na bíblia (ler_biblia).`,
      });
    case "notifications/initialized":
    case "notifications/cancelled":
      return ok({});
    case "ping":
      return ok({});
    case "tools/list":
      return ok({
        tools: ferramentasDe(agente).map((f) => ({
          name: f.nome,
          description: f.descricao,
          inputSchema: f.entrada,
        })),
      });
    case "tools/call": {
      const nome = String(m.params?.name ?? "");
      const args = { ...((m.params?.arguments as Record<string, unknown>) ?? {}) };
      const f = ferramentasDe(agente).find((x) => x.nome === nome);
      if (!f) return erro(-32602, `ferramenta ${nome} não existe ou não é permitida para ${agente}`);
      let rota = f.rota;
      for (const [k, v] of Object.entries(args)) {
        if (rota.includes(`{${k}}`)) {
          rota = rota.replace(`{${k}}`, encodeURIComponent(String(v)));
          delete args[k];
        }
      }
      rota = rota.replace(/\/\{[^}]+\}/g, ""); // parâmetro opcional ausente (ex.: ler_biblia sem slug)
      // Quem age é o agente: os campos de autoria levam o nome dele.
      if (f.metodo === "POST") {
        if (f.rota === "/eventos" || f.rota === "/custos") args.agente = agente;
        if (f.rota === "/propostas") args.autor = agente;
        if (f.rota === "/biblia") args.autor = agente;
        if (f.rota.endsWith("/decidir")) args.decididoPor = agente;
        if (f.rota === "/pausa") args.autor = agente;
        if (f.rota === "/nichos") args.autor = agente;
      }
      const query =
        f.metodo === "GET" && Object.keys(args).length
          ? `?${new URLSearchParams(Object.entries(args).map(([k, v]) => [k, String(v)] as [string, string]))}`
          : "";
      const r = await app.inject({
        method: f.metodo,
        url: `${rota}${query}`,
        headers: {
          "x-service-token": serviceToken,
          "x-origem": "openbot",
          "x-agente": agente,
          ...(f.metodo === "POST" ? { "content-type": "application/json" } : {}),
        },
        ...(f.metodo === "POST" ? { payload: JSON.stringify(args) } : {}),
      });
      return ok({ content: [{ type: "text", text: r.body.slice(0, 60_000) }], isError: r.statusCode >= 400 });
    }
    default:
      return erro(-32601, `método ${m.method} não suportado`);
  }
}
