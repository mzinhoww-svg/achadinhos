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

export const FERRAMENTAS_PENDENTES: readonly FerramentaPendente[] = [
  {
    metodo: "POST",
    rota: "/coleta/buscar",
    ferramenta: "/coleta/buscar",
    quemChama: "Garimpeiro",
    motivo:
      "Cliente da Open API da Shopee ainda não construído; depende de SHOPEE_APP_ID e SHOPEE_SECRET validados.",
  },
  {
    metodo: "GET",
    rota: "/precos/historico",
    ferramenta: "/precos/historico",
    quemChama: "Monitor",
    motivo: "Histórico de preço depende da coleta (/coleta/buscar).",
  },
  {
    metodo: "GET",
    rota: "/ofertas",
    ferramenta: "/ofertas",
    quemChama: "Monitor",
    motivo: "Ofertas dependem da coleta e do histórico de preço.",
  },
  {
    metodo: "POST",
    rota: "/ofertas",
    ferramenta: "/ofertas",
    quemChama: "Monitor",
    motivo: "Criação de oferta exige desconto real contra a mediana de 30 dias, que depende do histórico.",
  },
  {
    metodo: "POST",
    rota: "/imagem/render",
    ferramenta: "/imagem/render",
    quemChama: "Arte",
    motivo: "Renderização (sharp + Satori) ainda não construída; depende de TEMPLATES-VISUAIS na bíblia.",
  },
  {
    metodo: "POST",
    rota: "/ofertas/:id/copy",
    ferramenta: "/ofertas/:id/copy",
    quemChama: "Copywriter",
    motivo: "Validação da copy contra o banco ainda não construída; depende de ofertas.",
  },
  {
    metodo: "POST",
    rota: "/ofertas/:id/checar",
    ferramenta: "/ofertas/:id/checar",
    quemChama: "Coordenador",
    motivo: "Checagem automática depende de CHECAGEM na bíblia e das ferramentas de oferta, copy e imagem.",
  },
  {
    metodo: "GET",
    rota: "/pausa",
    ferramenta: "/pausa",
    quemChama: "Coordenador, painel",
    motivo: "Pausa geral será construída junto com o disparo.",
  },
  {
    metodo: "POST",
    rota: "/pausa",
    ferramenta: "/pausa",
    quemChama: "Coordenador, painel, WhatsApp",
    motivo: "Pausa geral será construída junto com o disparo.",
  },
  {
    metodo: "POST",
    rota: "/disparo",
    ferramenta: "/disparo",
    quemChama: "Disparador",
    motivo:
      "Envio pelo wa-gateway ainda não construído; depende de WA_GATEWAY_TOKEN, da checagem e da pausa.",
  },
  {
    metodo: "GET",
    rota: "/numeros",
    ferramenta: "/numeros",
    quemChama: "Coordenador",
    motivo: "Pool de números e failover dependem do wa-gateway.",
  },
  {
    metodo: "POST",
    rota: "/numeros",
    ferramenta: "/numeros",
    quemChama: "Coordenador",
    motivo: "Pool de números e failover dependem do wa-gateway.",
  },
];
