/** Formatos devolvidos pelo worker para as telas do painel (Prompt 6). */
export interface Resumo {
  ofertas: { enviadas: number; agendadas: number; falhas: number; avaliadas: number; reprovadas: number };
  cliques: { hoje: number; ontem: number };
  conversoes: { hoje: number; ontem: number };
  comissao: { hoje: number; ontem: number };
  llm: { dia: number; mes: number; tetoDiario: number; tetoMensal: number };
  proxima: { em: string | null; grupo: string; produto: string } | null;
  alertas: { id: number; tipo: string; dados: Record<string, unknown>; criadoEm: string }[];
}

export interface NumeroGateway {
  instanceId: string;
  ordem: number;
  papel: "ativo" | "reserva" | "banido" | "bloqueado";
  conexao: string;
  aguardandoQr: boolean;
  telefone: string | null;
  ultimoHeartbeat: string | null;
  falhasSeguidas: number;
  motivo: string | null;
  aquecimento: { dias: number; tetoDiario: number; enviadosHoje: number };
}

export interface Nicho {
  id: number;
  nome: string;
  ativo: boolean;
  palavras: string[];
  precoMin: string | null;
  precoMax: string | null;
  descontoMinPct: string;
  avaliacaoMin: string;
  vendasMin: number;
  marketplace: string;
  template: string | null;
  modeloLlm: string | null;
}

export interface Grupo {
  id: number;
  nome: string;
  waJid: string | null;
  promessa: string | null;
  teste: boolean;
  ativo: boolean;
  maxPorDia: number | null;
  horarios: string[];
  linkEntrada: string | null;
  nichoIds: number[];
}

export interface OfertaLista {
  id: number;
  status: string;
  preco: number;
  mediana30d: number | null;
  descontoPct: number | null;
  pontuacao: number | null;
  criadoEm: string;
  motivoReprovacao?: string | null;
  produto: { id: number; nome: string; fotoUrl: string | null; idExterno: string; url?: string };
}

export interface Checagem {
  id: number;
  ofertaId: number;
  aprovada: boolean;
  motivos: { codigo: string; detalhe: string }[];
  agente: string;
  criadoEm: string;
  produto: string;
  ensaio: boolean;
}

export interface Envio {
  id: number;
  status: string;
  agendadoPara: string | null;
  enviadoEm: string | null;
  extra: boolean;
  erro: string | null;
  numero: string | null;
  ofertaId: number;
  grupo: string;
  grupoId: number;
  produto: string;
  ensaio: boolean;
  imagemUrl: string | null;
  texto: string | null;
}

export interface LinhaMetrica {
  chave: string;
  enviadas: number;
  cliques: number;
  conversoes: number;
  comissao: number;
  custoLlmUsd: number | null;
}

export interface LinkCurto {
  id: number;
  codigo: string;
  ofertaId: number;
  produto: string;
  grupo: string | null;
  subIds: Record<string, string>;
  criadoEm: string;
  cliques: number;
  unicos: number;
}

export interface Conversao {
  id: number;
  pedido: string;
  valor: string | null;
  comissao: string | null;
  status: string | null;
  dia: string | null;
  ofertaId: number | null;
  grupo: string | null;
  produto: string | null;
}

export interface RegistroAuditoria {
  id: number;
  ator: string;
  acao: string;
  alvo: string | null;
  detalhes: Record<string, unknown>;
  criadoEm: string;
}

export const brl = (v: number | string | null | undefined) =>
  v == null || v === "" ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const usd = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD" });
export const hora = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        dateStyle: "short",
        timeStyle: "short",
      })
    : "—";
