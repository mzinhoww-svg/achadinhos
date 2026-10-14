/**
 * Dados fictícios do protótipo (T3). Nada aqui é real: sem credenciais, sem IDs de afiliado reais.
 * Datas em UTC (como no banco); a UI converte para America/Cuiaba.
 */
export type SendStatus = "queued" | "sending" | "sent" | "failed" | "skipped";

export const account = {
  handle: "@achadinhos.demo",
  timezone: "America/Cuiaba",
  dailyCapPerChannel: 200,
  dedupeDays: 7,
  maxAutomations: 5,
} as const;

export const shopee = {
  status: "connected" as "connected" | "pending" | "error",
  appIdMasked: "1835•••••42",
  validatedAt: "2026-10-12T21:14:00Z",
};

export const telegram = {
  status: "connected" as "connected" | "pending" | "error",
  botName: "@achadinhos_demo_bot",
};

export interface Group {
  id: string;
  name: string;
  subId: string;
  active: boolean;
  members: number;
}

export const groups: Group[] = [
  { id: "g1", name: "Achadinhos Tech", subId: "tg-tech-01", active: true, members: 1240 },
  { id: "g2", name: "Casa & Cozinha em Oferta", subId: "tg-casa-02", active: true, members: 870 },
  { id: "g3", name: "Moda Barata do Dia", subId: "tg-moda-03", active: true, members: 410 },
  { id: "g4", name: "Teste interno", subId: "tg-teste-04", active: false, members: 3 },
];

export interface Automation {
  id: string;
  name: string;
  status: "active" | "paused";
  groupIds: string[];
  category: string;
  minDiscount: number;
  minCommission: number;
  maxPrice: number | null;
  minRating: number;
  days: string[];
  windowStart: string;
  windowEnd: string;
  frequencyMin: 15 | 30 | 60;
  header: string;
  footer: string;
  nextRunAt: string;
  sentToday: number;
}

export const automations: Automation[] = [
  {
    id: "a1",
    name: "Eletrônicos até R$ 150",
    status: "active",
    groupIds: ["g1"],
    category: "Eletrônicos",
    minDiscount: 30,
    minCommission: 5,
    maxPrice: 150,
    minRating: 4.5,
    days: ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"],
    windowStart: "08:00",
    windowEnd: "22:00",
    frequencyMin: 30,
    header: "🔥 Achadinho do dia",
    footer: "Preço pode mudar a qualquer momento.",
    nextRunAt: "2026-10-13T15:30:00Z",
    sentToday: 18,
  },
  {
    id: "a2",
    name: "Casa e cozinha — manhã",
    status: "active",
    groupIds: ["g2", "g4"],
    category: "Casa e Cozinha",
    minDiscount: 25,
    minCommission: 4,
    maxPrice: 200,
    minRating: 4.3,
    days: ["seg", "ter", "qua", "qui", "sex"],
    windowStart: "07:00",
    windowEnd: "12:00",
    frequencyMin: 60,
    header: "Casa em dia",
    footer: "",
    nextRunAt: "2026-10-14T11:00:00Z",
    sentToday: 5,
  },
  {
    id: "a3",
    name: "Moda feminina acima de 40% off",
    status: "paused",
    groupIds: ["g3"],
    category: "Moda Feminina",
    minDiscount: 40,
    minCommission: 6,
    maxPrice: null,
    minRating: 4.0,
    days: ["sáb", "dom"],
    windowStart: "10:00",
    windowEnd: "20:00",
    frequencyMin: 15,
    header: "",
    footer: "Tamanhos podem esgotar rápido.",
    nextRunAt: "2026-10-17T14:00:00Z",
    sentToday: 0,
  },
];

export interface Offer {
  id: string;
  title: string;
  hue: number;
  label: string;
  price: number;
  oldPrice: number;
  commissionRate: number;
  rating: number;
  sales: number;
  category: string;
}

export const offers: Offer[] = [
  { id: "o1", title: "Fone de ouvido Bluetooth com cancelamento de ruído e estojo carregador", hue: 340, label: "FONE", price: 99.9, oldPrice: 189.9, commissionRate: 8, rating: 4.8, sales: 12400, category: "Eletrônicos" },
  { id: "o2", title: "Fritadeira elétrica sem óleo 4 litros com timer digital", hue: 20, label: "AIRFRYER", price: 219.0, oldPrice: 389.0, commissionRate: 6, rating: 4.7, sales: 8100, category: "Casa e Cozinha" },
  { id: "o3", title: "Smartwatch com monitor de batimentos e pulseira extra", hue: 200, label: "RELÓGIO", price: 129.9, oldPrice: 259.9, commissionRate: 9, rating: 4.4, sales: 5300, category: "Eletrônicos" },
  { id: "o4", title: "Kit 3 organizadores de gaveta em bambu", hue: 120, label: "KIT", price: 39.9, oldPrice: 79.9, commissionRate: 7, rating: 4.6, sales: 2900, category: "Casa e Cozinha" },
  { id: "o5", title: "Vestido midi canelado manga curta", hue: 300, label: "VESTIDO", price: 54.9, oldPrice: 119.9, commissionRate: 10, rating: 4.2, sales: 1600, category: "Moda Feminina" },
  { id: "o6", title: "Carregador turbo 33W USB-C com cabo reforçado", hue: 250, label: "33W", price: 34.9, oldPrice: 59.9, commissionRate: 5, rating: 4.9, sales: 21700, category: "Eletrônicos" },
  { id: "o7", title: "Jogo de panelas antiaderentes 5 peças", hue: 40, label: "PANELAS", price: 169.9, oldPrice: 329.9, commissionRate: 7, rating: 4.5, sales: 3800, category: "Casa e Cozinha" },
  { id: "o8", title: "Tênis esportivo leve para caminhada", hue: 160, label: "TÊNIS", price: 89.9, oldPrice: 149.9, commissionRate: 8, rating: 4.1, sales: 970, category: "Moda" },
];

export interface Send {
  id: string;
  offerId: string;
  groupId: string;
  automationId: string | null;
  status: SendStatus;
  reason?: string;
  scheduledFor: string;
  sentAt?: string;
  shortLink: string;
  priority: number;
}

export const sends: Send[] = [
  { id: "s1", offerId: "o1", groupId: "g1", automationId: "a1", status: "sending", scheduledFor: "2026-10-13T15:00:00Z", shortLink: "s.shopee.com.br/demo01", priority: 0 },
  { id: "s2", offerId: "o6", groupId: "g1", automationId: null, status: "queued", scheduledFor: "2026-10-13T15:01:00Z", shortLink: "s.shopee.com.br/demo02", priority: 100 },
  { id: "s3", offerId: "o2", groupId: "g2", automationId: "a2", status: "queued", scheduledFor: "2026-10-13T15:30:00Z", shortLink: "s.shopee.com.br/demo03", priority: 0 },
  { id: "s4", offerId: "o3", groupId: "g1", automationId: "a1", status: "sent", scheduledFor: "2026-10-13T14:30:00Z", sentAt: "2026-10-13T14:30:12Z", shortLink: "s.shopee.com.br/demo04", priority: 0 },
  { id: "s5", offerId: "o4", groupId: "g2", automationId: "a2", status: "sent", scheduledFor: "2026-10-13T13:00:00Z", sentAt: "2026-10-13T13:00:09Z", shortLink: "s.shopee.com.br/demo05", priority: 0 },
  { id: "s6", offerId: "o1", groupId: "g1", automationId: "a1", status: "skipped", reason: "repetida (enviada há 2 dias)", scheduledFor: "2026-10-13T14:00:00Z", shortLink: "s.shopee.com.br/demo01", priority: 0 },
  { id: "s7", offerId: "o5", groupId: "g3", automationId: "a3", status: "failed", reason: "Telegram: bot removido do grupo", scheduledFor: "2026-10-12T18:00:00Z", shortLink: "s.shopee.com.br/demo06", priority: 0 },
  { id: "s8", offerId: "o7", groupId: "g2", automationId: "a2", status: "sent", scheduledFor: "2026-10-13T12:00:00Z", sentAt: "2026-10-13T12:00:07Z", shortLink: "s.shopee.com.br/demo07", priority: 0 },
  { id: "s9", offerId: "o8", groupId: "g3", automationId: "a3", status: "skipped", reason: "teto diário do canal atingido", scheduledFor: "2026-10-12T22:00:00Z", shortLink: "s.shopee.com.br/demo08", priority: 0 },
  { id: "s10", offerId: "o6", groupId: "g1", automationId: "a1", status: "sent", scheduledFor: "2026-10-13T11:30:00Z", sentAt: "2026-10-13T11:30:10Z", shortLink: "s.shopee.com.br/demo02", priority: 0 },
];

export const offerById = (id: string) => offers.find((o) => o.id === id)!;
export const groupById = (id: string) => groups.find((g) => g.id === id);
export const automationById = (id: string) => automations.find((a) => a.id === id);

export function discountOf(o: Offer): number {
  return Math.round((1 - o.price / o.oldPrice) * 100);
}

/** Estados vazios são previsualizáveis com ?vazio=1 em qualquer tela. */
export function isEmptyPreview(sp: { vazio?: string | string[] } | undefined): boolean {
  const v = sp?.vazio;
  return v === "1" || (Array.isArray(v) && v.includes("1"));
}
