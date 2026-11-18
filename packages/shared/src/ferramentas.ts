/**
 * Ferramentas do worker (pacote/CONTRATO.md). As que ainda não existem respondem 501 com o motivo
 * (capacidade 9 do contrato: "falha sempre explicável").
 */
export interface FerramentaPendente {
  metodo: "GET" | "POST";
  rota: string;
  ferramenta: string;
  quemChama: string;
  motivo: string;
}

/** Todas as ferramentas do contrato existem desde o Prompt 5; a lista fica para as próximas fases. */
export const FERRAMENTAS_PENDENTES: readonly FerramentaPendente[] = [];
