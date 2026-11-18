import { createHmac } from "node:crypto";

/**
 * Ferramentas do worker para os agentes do OpenBot (T7.1), no formato MCP (nome, descrição, inputSchema).
 * Cada ferramenta vira uma chamada HTTP interna ao worker. A permissão é mínima por agente: cada agente tem o
 * próprio token e só vê (e só chama) as ferramentas da sua função.
 */

export type Agente =
  | "Coordenador"
  | "Garimpeiro"
  | "Monitor"
  | "Diretor de Arte"
  | "Copywriter"
  | "Disparador";
export const AGENTES: Agente[] = [
  "Coordenador",
  "Garimpeiro",
  "Monitor",
  "Diretor de Arte",
  "Copywriter",
  "Disparador",
];

type Esquema = Record<string, unknown>;
export interface Ferramenta {
  nome: string;
  descricao: string;
  entrada: Esquema;
  metodo: "GET" | "POST";
  /** Rota com {param} substituído pelos argumentos; o resto vai no corpo (POST) ou na query (GET). */
  rota: string;
  agentes: Agente[];
}

const obj = (props: Record<string, Esquema>, obrigatorios: string[] = []): Esquema => ({
  type: "object",
  properties: props,
  required: obrigatorios,
  additionalProperties: false,
});
const int = (descricao: string): Esquema => ({ type: "integer", minimum: 1, description: descricao });
const str = (descricao: string): Esquema => ({ type: "string", description: descricao });
const TODOS = AGENTES;

export const FERRAMENTAS: Ferramenta[] = [
  // ---------- todos ----------
  {
    nome: "registrar_evento",
    descricao:
      "Registra no log o que você fez (vira evento no painel). Use tipos como 'coleta.analisada' ou 'proposta.sugerida'.",
    entrada: obj(
      {
        tipo: str("minúsculas separadas por ponto"),
        dados: { type: "object" },
        ofertaId: int("oferta relacionada"),
      },
      ["tipo"],
    ),
    metodo: "POST",
    rota: "/eventos",
    agentes: TODOS,
  },
  {
    nome: "ler_biblia",
    descricao:
      "Lê um documento da bíblia (ex.: NICHOS, TOM-DE-VOZ, CHECAGEM, REGRAS-DE-ENVIO, ROTINA). Sem slug, lista os documentos.",
    entrada: obj({ slug: str("slug do documento, ex.: TOM-DE-VOZ") }),
    metodo: "GET",
    rota: "/biblia/{slug}",
    agentes: TODOS,
  },
  {
    nome: "propor_mudanca",
    descricao:
      "Sugere uma mudança (regra, horário, nicho). O Coordenador decide. Para mudar um documento, mande docSlug e o texto completo.",
    entrada: obj(
      {
        titulo: str("resumo"),
        descricao: str("o porquê, com números"),
        docSlug: str("documento da bíblia"),
        conteudoProposto: str("texto completo novo"),
      },
      ["titulo", "descricao"],
    ),
    metodo: "POST",
    rota: "/propostas",
    agentes: TODOS,
  },
  {
    nome: "registrar_custo",
    descricao:
      "Registra o custo de uma chamada sua ao LLM (modelo, tokens e custo em US$), para o teto diário e o painel.",
    entrada: obj(
      {
        modelo: str("ex.: openai/gpt-4o-mini"),
        tokensEntrada: { type: "integer" },
        tokensSaida: { type: "integer" },
        custoUsd: { type: "number" },
        ofertaId: int("se for de uma oferta"),
      },
      ["modelo", "custoUsd"],
    ),
    metodo: "POST",
    rota: "/custos",
    agentes: TODOS,
  },
  // ---------- Garimpeiro ----------
  {
    nome: "listar_nichos",
    descricao: "Nichos com palavras-chave e régua de oferta (desconto mínimo, nota, vendas, faixa de preço).",
    entrada: obj({}),
    metodo: "GET",
    rota: "/nichos",
    agentes: ["Garimpeiro", "Coordenador"],
  },
  {
    nome: "buscar_produtos",
    descricao: "Roda as palavras-chave de um nicho na Shopee e grava os produtos (sem duplicar).",
    entrada: obj({ nichoId: int("id do nicho"), paginas: { type: "integer", minimum: 1, maximum: 5 } }, [
      "nichoId",
    ]),
    metodo: "POST",
    rota: "/coleta/buscar",
    agentes: ["Garimpeiro"],
  },
  {
    nome: "listar_produtos",
    descricao: "Produtos coletados de um nicho.",
    entrada: obj({ nichoId: int("id do nicho"), limite: { type: "integer", maximum: 200 } }),
    metodo: "GET",
    rota: "/produtos",
    agentes: ["Garimpeiro", "Monitor"],
  },
  // ---------- Monitor ----------
  {
    nome: "rodar_monitor",
    descricao:
      "Atualiza preço e estoque dos produtos acompanhados e cria as ofertas candidatas (regra de oferta real).",
    entrada: obj({ maxDetalhes: { type: "integer", minimum: 0, maximum: 2000 } }),
    metodo: "POST",
    rota: "/monitor/rodar",
    agentes: ["Monitor"],
  },
  {
    nome: "historico_precos",
    descricao: "Série de preços dos últimos dias e a mediana de um produto.",
    entrada: obj({ produtoId: int("id do produto"), dias: { type: "integer", maximum: 90 } }, ["produtoId"]),
    metodo: "GET",
    rota: "/precos/historico",
    agentes: ["Monitor"],
  },
  {
    nome: "listar_ofertas",
    descricao:
      "Ofertas por status (candidata, aprovada, reprovada, agendada, enviada, cancelada), as de maior pontuação primeiro.",
    entrada: obj({ status: str("status"), nichoId: int("nicho"), limite: { type: "integer", maximum: 200 } }),
    metodo: "GET",
    rota: "/ofertas",
    agentes: ["Monitor", "Copywriter", "Diretor de Arte", "Disparador", "Coordenador"],
  },
  {
    nome: "detalhe_oferta",
    descricao: "Tudo de uma oferta: produto, curva de preço, peças, copies, checagens e envios.",
    entrada: obj({ id: int("id da oferta") }, ["id"]),
    metodo: "GET",
    rota: "/ofertas/{id}",
    agentes: ["Monitor", "Copywriter", "Diretor de Arte", "Disparador", "Coordenador"],
  },
  // ---------- Diretor de Arte ----------
  {
    nome: "renderizar_peca",
    descricao:
      "Gera as peças (quadrado e retrato) com a foto real do produto. forcarFallback usa a foto original na moldura.",
    entrada: obj(
      {
        ofertaId: int("id da oferta"),
        formato: { type: "string", enum: ["quadrado", "retrato", "ambos"] },
        forcarFallback: { type: "boolean" },
      },
      ["ofertaId"],
    ),
    metodo: "POST",
    rota: "/imagem/render",
    agentes: ["Diretor de Arte"],
  },
  {
    nome: "listar_pecas",
    descricao: "Peças renderizadas de uma oferta, com confiança do recorte e fallback.",
    entrada: obj({ ofertaId: int("id da oferta") }),
    metodo: "GET",
    rota: "/imagens",
    agentes: ["Diretor de Arte", "Coordenador"],
  },
  // ---------- Copywriter ----------
  {
    nome: "gerar_copy",
    descricao: "Gera 2 variações de texto para a oferta, valida contra o banco e escolhe a válida.",
    entrada: obj({ id: int("id da oferta") }, ["id"]),
    metodo: "POST",
    rota: "/ofertas/{id}/copy",
    agentes: ["Copywriter"],
  },
  // ---------- Disparador ----------
  {
    nome: "agendar_disparo",
    descricao:
      "Agenda as ofertas aprovadas nos horários da bíblia. executar=true manda já o que está na hora (respeita a pausa).",
    entrada: obj({ ofertaId: int("só esta oferta"), executar: { type: "boolean" } }),
    metodo: "POST",
    rota: "/disparo",
    agentes: ["Disparador"],
  },
  {
    nome: "listar_envios",
    descricao: "Envios recentes (agendado, enviado, falhou, cancelado).",
    entrada: obj({ status: str("status"), dias: { type: "integer", maximum: 90 } }),
    metodo: "GET",
    rota: "/envios",
    agentes: ["Disparador", "Coordenador"],
  },
  {
    nome: "ver_pausa",
    descricao: "Se a operação está pausada, por quem e por quê.",
    entrada: obj({}),
    metodo: "GET",
    rota: "/pausa",
    agentes: ["Disparador", "Coordenador"],
  },
  // ---------- Coordenador ----------
  {
    nome: "gravar_biblia",
    descricao: "Grava uma nova versão de um documento da bíblia (texto completo em markdown).",
    entrada: obj(
      { slug: str("ex.: NICHOS"), conteudo: str("markdown completo"), motivo: str("por que mudou") },
      ["slug", "conteudo"],
    ),
    metodo: "POST",
    rota: "/biblia",
    agentes: ["Coordenador"],
  },
  {
    nome: "listar_propostas",
    descricao: "Propostas dos agentes (abertas ou decididas).",
    entrada: obj({ status: { type: "string", enum: ["aberta", "aprovada", "rejeitada"] } }),
    metodo: "GET",
    rota: "/propostas",
    agentes: ["Coordenador"],
  },
  {
    nome: "decidir_proposta",
    descricao:
      "Aprova ou rejeita uma proposta. Aprovada com documento vira nova versão da bíblia. Mudanças de gasto ou grupos entram no resumo do dia.",
    entrada: obj(
      {
        id: int("id da proposta"),
        decisao: { type: "string", enum: ["aprovada", "rejeitada"] },
        comentario: str("motivo"),
      },
      ["id", "decisao"],
    ),
    metodo: "POST",
    rota: "/propostas/{id}/decidir",
    agentes: ["Coordenador"],
  },
  {
    nome: "listar_numeros",
    descricao: "Chips do WhatsApp: ativo, reservas, conexão, último sinal e aquecimento.",
    entrada: obj({}),
    metodo: "GET",
    rota: "/numeros",
    agentes: ["Coordenador"],
  },
  {
    nome: "promover_numero",
    descricao: "Troca o chip ativo (só em falha técnica; banimento pausa tudo).",
    entrada: obj({ instanceId: str("apelido do chip") }, ["instanceId"]),
    metodo: "POST",
    rota: "/numeros/{instanceId}/promover",
    agentes: ["Coordenador"],
  },
  {
    nome: "definir_pausa",
    descricao: "Pausa ou retoma toda a operação na hora.",
    entrada: obj({ pausado: { type: "boolean" }, motivo: str("motivo") }, ["pausado", "motivo"]),
    metodo: "POST",
    rota: "/pausa",
    agentes: ["Coordenador"],
  },
  {
    nome: "preparar_oferta",
    descricao: "Roda arte, copy e checagem de uma oferta; aprovada é agendada sozinha.",
    entrada: obj({ id: int("id da oferta") }, ["id"]),
    metodo: "POST",
    rota: "/ofertas/{id}/preparar",
    agentes: ["Coordenador"],
  },
  {
    nome: "checar_oferta",
    descricao: "Checagem automática de uma oferta (motivos de reprovação); aprovada é agendada sozinha.",
    entrada: obj({ id: int("id da oferta") }, ["id"]),
    metodo: "POST",
    rota: "/ofertas/{id}/checar",
    agentes: ["Coordenador"],
  },
  {
    nome: "oferta_de_ensaio",
    descricao: "Cria uma oferta falsa (foto e link reais) que roda o ciclo inteiro só nos grupos de teste.",
    entrada: obj({
      nichoId: int("nicho"),
      descontoPct: { type: "number" },
      defeito: { type: "string", enum: ["preco"] },
    }),
    metodo: "POST",
    rota: "/ensaio/oferta",
    agentes: ["Coordenador"],
  },
  {
    nome: "resumo_do_dia",
    descricao: "Números do dia (envios, checagens, cliques, conversões, gasto de IA).",
    entrada: obj({}),
    metodo: "GET",
    rota: "/painel/resumo",
    agentes: ["Coordenador"],
  },
  {
    nome: "metricas",
    descricao: "Enviadas, cliques, conversões, comissão e custo por nicho, grupo, horário ou oferta.",
    entrada: obj({
      recorte: { type: "string", enum: ["nicho", "grupo", "horario", "oferta"] },
      dias: { type: "integer", maximum: 90 },
    }),
    metodo: "GET",
    rota: "/metricas",
    agentes: ["Coordenador"],
  },
  {
    nome: "enviar_resumo_whatsapp",
    descricao:
      "Fecha o dia: manda o resumo no WhatsApp do Aurimar (inclui as propostas aprovadas que mexem em gasto ou grupos).",
    entrada: obj({ observacoes: str("até 500 caracteres do Coordenador") }),
    metodo: "POST",
    rota: "/resumo/enviar",
    agentes: ["Coordenador"],
  },
  {
    nome: "salvar_nicho",
    descricao: "Cria ou atualiza um nicho pelo nome (palavras-chave e régua de oferta).",
    entrada: obj(
      {
        nome: str("nome do nicho"),
        palavras: { type: "array", items: { type: "string" } },
        precoMin: { type: "number" },
        precoMax: { type: "number" },
        descontoMinPct: { type: "number" },
        avaliacaoMin: { type: "number" },
        vendasMin: { type: "integer" },
        ativo: { type: "boolean" },
      },
      ["nome", "palavras"],
    ),
    metodo: "POST",
    rota: "/nichos",
    agentes: ["Coordenador"],
  },
];

/** Token do agente: HMAC do SERVICE_TOKEN com o nome. O worker confere sem guardar nada. */
export function tokenAgente(serviceToken: string, agente: Agente): string {
  return `ach_${createHmac("sha256", serviceToken).update(`agente:${agente}`).digest("hex").slice(0, 40)}`;
}

export function ferramentasDe(agente: Agente) {
  return FERRAMENTAS.filter((f) => f.agentes.includes(agente));
}
