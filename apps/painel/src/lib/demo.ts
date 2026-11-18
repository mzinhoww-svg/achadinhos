/**
 * Dados FALSOS do esqueleto do painel (docs/PAINEL.md). Cada tela que usa este arquivo mostra a faixa
 * "Demonstração". Sai daqui assim que a ferramenta correspondente do worker existir.
 */

export type StatusOferta = "candidata" | "aprovada" | "reprovada" | "agendada" | "enviada";

export interface OfertaDemo {
  id: number;
  nome: string;
  foto: string;
  preco: number;
  mediana30d: number;
  nicho: string;
  grupo: string;
  status: StatusOferta;
  horario: string;
  motivo?: string;
  agente: string;
  copy: string;
  link: string;
}

export const NICHOS = [
  {
    id: 1,
    nome: "Casa até R$ 50",
    marketplace: "Shopee",
    precoMin: 10,
    precoMax: 50,
    palavras: ["organizador", "pote hermético", "toalha", "luminária led", "porta-temperos"],
    ativo: true,
  },
  {
    id: 2,
    nome: "Cozinha prática",
    marketplace: "Shopee",
    precoMin: 15,
    precoMax: 120,
    palavras: ["air fryer acessório", "mixer", "tábua", "faca chef"],
    ativo: true,
  },
  {
    id: 3,
    nome: "Pet",
    marketplace: "Shopee",
    precoMin: 10,
    precoMax: 80,
    palavras: ["cama pet", "comedouro", "brinquedo gato"],
    ativo: false,
  },
];

export const GRUPOS = [
  {
    id: 1,
    nome: "Achadinhos Casa",
    promessa: "Achadinhos de casa até R$ 50",
    nichos: ["Casa até R$ 50"],
    horarios: ["09:00", "13:00", "20:00"],
    maxDia: 6,
    teste: false,
    ativo: true,
    membros: 312,
  },
  {
    id: 2,
    nome: "Achadinhos Cozinha",
    promessa: "Cozinha prática com desconto real",
    nichos: ["Cozinha prática"],
    horarios: ["12:00", "19:00"],
    maxDia: 4,
    teste: false,
    ativo: true,
    membros: 148,
  },
  {
    id: 3,
    nome: "Teste (só meus números)",
    promessa: "Ensaio de 3 dias",
    nichos: ["Casa até R$ 50", "Cozinha prática"],
    horarios: ["10:00", "16:00"],
    maxDia: 10,
    teste: true,
    ativo: true,
    membros: 3,
  },
];

const FOTO = (n: number) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" rx="16" fill="hsl(${(n * 47) % 360} 70% 88%)"/><text x="60" y="68" font-family="sans-serif" font-size="14" text-anchor="middle" fill="#555">foto real</text></svg>`)}`;

const OFERTAS_BASE: Omit<OfertaDemo, "foto" | "link">[] = [
  {
    id: 101,
    nome: "Kit 6 potes herméticos 520 ml",
    preco: 39.9,
    mediana30d: 59.9,
    nicho: "Casa até R$ 50",
    grupo: "Achadinhos Casa",
    status: "enviada",
    horario: "09:00",
    agente: "Disparador",
    copy: "🏠 Kit 6 potes herméticos 520 ml\nDe R$ 59,90 por R$ 39,90 (-33%)\nPreço pode mudar a qualquer momento. #publi",
  },
  {
    id: 102,
    nome: "Luminária LED de mesa recarregável",
    preco: 34.5,
    mediana30d: 48.0,
    nicho: "Casa até R$ 50",
    grupo: "Achadinhos Casa",
    status: "enviada",
    horario: "13:00",
    agente: "Disparador",
    copy: "💡 Luminária LED recarregável\nDe R$ 48,00 por R$ 34,50 (-28%)\nPreço pode mudar. #publi",
  },
  {
    id: 103,
    nome: "Tábua de corte de bambu 3 peças",
    preco: 44.9,
    mediana30d: 69.9,
    nicho: "Cozinha prática",
    grupo: "Achadinhos Cozinha",
    status: "agendada",
    horario: "19:00",
    agente: "Disparador",
    copy: "🔪 Tábuas de bambu (3 peças)\nDe R$ 69,90 por R$ 44,90 (-36%)\nPreço pode mudar. #publi",
  },
  {
    id: 104,
    nome: "Organizador de gaveta 8 divisórias",
    preco: 22.9,
    mediana30d: 23.5,
    nicho: "Casa até R$ 50",
    grupo: "Achadinhos Casa",
    status: "reprovada",
    horario: "08:40",
    motivo: "Desconto abaixo do mínimo (3% < 15%)",
    agente: "Monitor",
    copy: "",
  },
  {
    id: 105,
    nome: "Porta-temperos giratório 12 potes",
    preco: 49.9,
    mediana30d: 79.9,
    nicho: "Casa até R$ 50",
    grupo: "Achadinhos Casa",
    status: "reprovada",
    horario: "11:20",
    motivo: "Produto repetido em menos de 7 dias",
    agente: "Coordenador",
    copy: "",
  },
  {
    id: 106,
    nome: "Mixer de mão 250 W",
    preco: 89.0,
    mediana30d: 129.0,
    nicho: "Cozinha prática",
    grupo: "Achadinhos Cozinha",
    status: "reprovada",
    horario: "12:05",
    motivo: "Preço da copy diferente do banco (R$ 79,00 × R$ 89,00)",
    agente: "Coordenador",
    copy: "",
  },
  {
    id: 107,
    nome: "Jogo de toalhas 4 peças algodão",
    preco: 47.9,
    mediana30d: 74.9,
    nicho: "Casa até R$ 50",
    grupo: "Achadinhos Casa",
    status: "aprovada",
    horario: "20:00",
    agente: "Coordenador",
    copy: "🛁 Jogo de toalhas 4 peças\nDe R$ 74,90 por R$ 47,90 (-36%)\nPreço pode mudar. #publi",
  },
  {
    id: 108,
    nome: "Faca chef inox 8 polegadas",
    preco: 59.9,
    mediana30d: 72.0,
    nicho: "Cozinha prática",
    grupo: "—",
    status: "candidata",
    horario: "13:30",
    agente: "Monitor",
    copy: "",
  },
];

export const OFERTAS: OfertaDemo[] = OFERTAS_BASE.map((o, i) => ({
  ...o,
  foto: FOTO(i + 1),
  link: `https://ach.ad/${o.id}`,
}));

export const desconto = (o: Pick<OfertaDemo, "preco" | "mediana30d">) =>
  Math.round((1 - o.preco / o.mediana30d) * 100);

export const CHIPS = [
  {
    apelido: "Chip A",
    papel: "ativo" as const,
    status: "conectado" as const,
    ultimoEnvio: "13:00",
    final: "··· 41",
  },
  {
    apelido: "Chip B",
    papel: "reserva" as const,
    status: "conectado" as const,
    ultimoEnvio: "ontem 20:00",
    final: "··· 87",
  },
  {
    apelido: "Chip C",
    papel: "reserva" as const,
    status: "aquecendo" as const,
    ultimoEnvio: "—",
    final: "··· 12",
  },
];

export const QUEDAS = [
  {
    quando: "15/11 21:14",
    caiu: "Chip B",
    assumiu: "Chip A",
    fora: "3 min",
    motivo: "Desconectado pelo WhatsApp",
  },
  { quando: "09/11 09:02", caiu: "Chip A", assumiu: "Chip B", fora: "6 min", motivo: "Sessão expirada" },
];

export const HOJE = {
  pausada: false,
  desde: "08:00",
  enviadas: 2,
  reprovadas: 3,
  avaliadas: 8,
  proxima: { horario: "19:00", grupo: "Achadinhos Cozinha" },
  cliques: { hoje: 184, ontem: 151 },
  conversoes: { hoje: 7, ontem: 5 },
  comissao: { hoje: 23.4, ontem: 17.1 },
  llm: { hojeUsd: 0.62, tetoUsd: 2.0 },
};

export const ALERTAS = [
  { nivel: "aviso" as const, texto: "Taxa de reprovação de hoje em 37% (trava em 20%)", href: "/checagens" },
  { nivel: "info" as const, texto: "Chip C ainda aquecendo (dia 9 de 21)", href: "/chips" },
];

export type Recorte = "nicho" | "grupo" | "horario" | "oferta";

/** Métricas de 7 dias por recorte (falsas). */
export const METRICAS: Record<
  Recorte,
  {
    chave: string;
    enviadas: number;
    cliques: number;
    conversoes: number;
    comissao: number;
    custoLlm: number;
  }[]
> = {
  nicho: [
    { chave: "Casa até R$ 50", enviadas: 34, cliques: 980, conversoes: 31, comissao: 102.4, custoLlm: 2.9 },
    { chave: "Cozinha prática", enviadas: 18, cliques: 410, conversoes: 11, comissao: 61.2, custoLlm: 1.7 },
  ],
  grupo: [
    { chave: "Achadinhos Casa", enviadas: 34, cliques: 980, conversoes: 31, comissao: 102.4, custoLlm: 2.9 },
    {
      chave: "Achadinhos Cozinha",
      enviadas: 18,
      cliques: 410,
      conversoes: 11,
      comissao: 61.2,
      custoLlm: 1.7,
    },
  ],
  horario: [
    { chave: "09:00", enviadas: 7, cliques: 220, conversoes: 6, comissao: 21.0, custoLlm: 0.6 },
    { chave: "12:00", enviadas: 7, cliques: 160, conversoes: 4, comissao: 19.8, custoLlm: 0.6 },
    { chave: "13:00", enviadas: 7, cliques: 240, conversoes: 8, comissao: 27.5, custoLlm: 0.6 },
    { chave: "19:00", enviadas: 7, cliques: 250, conversoes: 7, comissao: 41.4, custoLlm: 0.6 },
    { chave: "20:00", enviadas: 7, cliques: 360, conversoes: 13, comissao: 38.9, custoLlm: 0.6 },
  ],
  oferta: OFERTAS.filter((o) => o.status === "enviada" || o.status === "agendada").map((o, i) => ({
    chave: o.nome,
    enviadas: 1,
    cliques: 60 + i * 23,
    conversoes: 2 + i,
    comissao: 6.5 + i * 2.1,
    custoLlm: 0.08,
  })),
};

export const LINKS = OFERTAS.filter((o) => o.status === "enviada" || o.status === "agendada").map((o, i) => ({
  curto: o.link,
  oferta: o.nome,
  grupo: o.grupo,
  subIds: `g=${o.grupo === "Achadinhos Casa" ? 1 : 2}·n=${o.nicho === "Casa até R$ 50" ? 1 : 2}·o=${o.id}·h=${o.horario.replace(":", "")}`,
  cliques: 60 + i * 23,
}));

export const CONVERSOES = [
  {
    pedido: "SP-2611-0193",
    oferta: OFERTAS[0]?.nome ?? "",
    grupo: "Achadinhos Casa",
    horario: "09:00",
    valor: 39.9,
    comissao: 3.19,
    status: "pendente",
  },
  {
    pedido: "SP-2611-0188",
    oferta: OFERTAS[1]?.nome ?? "",
    grupo: "Achadinhos Casa",
    horario: "13:00",
    valor: 69.0,
    comissao: 5.52,
    status: "pendente",
  },
  {
    pedido: "SP-2511-0412",
    oferta: OFERTAS[2]?.nome ?? "",
    grupo: "Achadinhos Cozinha",
    horario: "19:00",
    valor: 44.9,
    comissao: 3.59,
    status: "aprovada",
  },
];

export const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const usd = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD" });
