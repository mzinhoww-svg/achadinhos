import "server-only";
import { MemoryAutomations, MemoryConnections, MemoryVault } from "./memory";
import type { SendsRepo } from "./envios-ports";
import { MemorySendNow } from "./memory-sends";
import type { AutomationsRepo, ConnectionsRepo, SecretVault, TelegramGateway } from "./ports";
import type { OfferCandidate, OfferFinder, SendNowRepo, ShortLinkGateway } from "./send-ports";
import { offers as demoOffers } from "@/lib/mock";
import { dayWindow } from "@/lib/envios-view";
import { createTelegramGateway } from "./telegram-gateway";
import type { Session, SessionProvider } from "./session";

export interface Container {
  connections: ConnectionsRepo;
  automations: AutomationsRepo;
  vault: SecretVault;
  telegram: TelegramGateway;
  sessions: SessionProvider;
  sendNow: SendNowRepo;
  sends: SendsRepo;
  /** Só no demo: avança a fila simulada um passo (queued→sending→sent) para a tela de Envios mudar sozinha. */
  advanceDemo?: () => void;
  finder: OfferFinder;
  links: ShortLinkGateway;
}

/**
 * Sessão demo = bypass de autenticação: nunca em produção. Em `next start` local de QA exige a segunda variável
 * explícita; em produção da Vercel nunca, com ou sem ela.
 */
const DEMO = () => {
  if (process.env.ACHADINHOS_DEMO_SESSION !== "1") return false;
  if (process.env.VERCEL_ENV === "production") return false;
  if (process.env.NODE_ENV === "production") return process.env.ACHADINHOS_DEMO_LOCAL_BUILD === "1";
  return true;
};
export const DEMO_ACCOUNT = "demo";
export const DEMO_EMPTY_ACCOUNT = "demo-vazio";

/** Telegram simulado do modo demo: aceita qualquer token bem formado e nunca sai da máquina. */
const demoTelegram: TelegramGateway = {
  async verifyToken() {
    return { botName: "@achadinhos_demo_bot" };
  },
  async listChats() {
    return [
      { chatId: "-1001000000001", name: "Achadinhos Tech", chatType: "supergroup", members: 1240 },
      { chatId: "-1001000000002", name: "Casa & Cozinha em Oferta", chatType: "supergroup", members: 870 },
      { chatId: "-1001000000003", name: "Moda Barata do Dia", chatType: "channel", members: 410 },
      { chatId: "777", name: "Conversa privada", chatType: "private", members: 1 },
    ];
  },
};

const demoCandidates: OfferCandidate[] = demoOffers.map((o, i) => ({
  itemId: String(9001 + i),
  title: o.title,
  imageUrl: `https://img.demo.invalid/${o.id}.jpg`,
  productLink: `https://shopee.com.br/product/1/${9001 + i}`,
  offerLink: `https://shopee.com.br/product/1/${9001 + i}?af=demo`,
  price: o.price,
  oldPrice: o.oldPrice,
  commissionRate: o.commissionRate,
  rating: o.rating,
  sales: o.sales,
  shopName: "Loja Demo",
  placeholderHue: o.hue,
}));
const matches = (c: OfferCandidate, q: string) => c.title.toLowerCase().includes(q.toLowerCase());

/** Shopee simulada do modo demo: catálogo fixo, sem rede. */
const demoFinder: OfferFinder = {
  async search(_a, keyword) {
    return demoCandidates.filter((c) => matches(c, keyword));
  },
  async byItemId(_a, itemId) {
    return demoCandidates.find((c) => c.itemId === itemId) ?? null;
  },
  async resolveShortUrl() {
    return demoCandidates[0] ?? null;
  },
};
const demoLinks: ShortLinkGateway = {
  async generate(_a, originUrl) {
    return `https://s.shopee.com.br/demo${(originUrl.length * 7919).toString(36)}`;
  },
};
/** Sem adaptador configurado nenhuma consulta à Shopee acontece (a web não lê o Secret; decisão 003 H1). */
const offlineFinder: OfferFinder = {
  async search() { throw new Error("finder_not_configured"); },
  async byItemId() { throw new Error("finder_not_configured"); },
  async resolveShortUrl() { throw new Error("finder_not_configured"); },
};
const offlineLinks: ShortLinkGateway = { async generate() { throw new Error("links_not_configured"); } };

/**
 * Sessão real (Supabase Auth) ainda não existe: sem a flag de demo, ninguém tem sessão e toda ação recusa.
 * No modo demo a conta vem do servidor (nunca do cliente).
 */
const sessions: SessionProvider = {
  async current(): Promise<Session | null> {
    return DEMO() ? { accountId: DEMO_ACCOUNT, userId: "demo-user" } : null;
  },
};

async function seed(c: Container) {
  const S = { accountId: DEMO_ACCOUNT, userId: "demo-user" };
  const { saveShopee, saveTelegram, setGroupActive } = await import("./connections");
  const { createAutomation } = await import("./automations");
  const deps = { repo: c.connections, vault: c.vault, telegram: c.telegram };
  await saveShopee(deps, S, { appId: "18350000042", secret: "demo-secret-nao-real-0042" });
  const tg = await saveTelegram(deps, S, { token: "1000000001:DEMO-token-nao-real-000000000000" });
  for (const g of tg.groups.slice(0, 3)) await setGroupActive(deps, S, { groupId: g.id, active: true });
  const ids = tg.groups.map((g) => g.id);
  const sn = c.sendNow as MemorySendNow;
  const off = await Promise.all(demoCandidates.map((cand) => sn.saveOffer(DEMO_ACCOUNT, cand)));
  const nowMs = Date.now();
  const ago = (min: number) => new Date(nowMs - min * 60_000);
  // "Hoje" no fuso da conta: nunca antes da 00:00 local, mesmo se o demo subir logo após a meia-noite.
  const dayStart = dayWindow(new Date(nowMs), "America/Cuiaba").start.getTime();
  const todayAgo = (min: number) => Math.max(0, Math.min((nowMs - dayStart) / 60_000 - 1, min)) ;
  const h = (n: number) => todayAgo(n * 60);
  const row = (i: number, g: number, status: "queued" | "sending" | "sent" | "failed" | "skipped", min: number, extra: { reason?: string; priority?: number; automationName?: string } = {}) =>
    sn.seed({ accountId: DEMO_ACCOUNT, offerId: off[i]!, groupId: ids[g]!, status, at: ago(min), ...extra });
  row(0, 0, "sent", 2 * 24 * 60, { automationName: "Eletrônicos até R$ 150" }); // alimenta o aviso de repetição
  row(2, 0, "sent", h(3), { automationName: "Eletrônicos até R$ 150" });
  row(3, 1, "sent", h(2), { automationName: "Casa e cozinha — manhã" });
  row(6, 1, "sent", h(5), { automationName: "Casa e cozinha — manhã" });
  row(5, 0, "sent", todayAgo(40), { priority: 100 });
  row(4, 2, "failed", h(4), { reason: "Telegram: bot removido do grupo", automationName: "Eletrônicos até R$ 150" });
  row(7, 2, "skipped", h(6), { reason: "teto diário do canal atingido" });
  row(1, 1, "sending", 0, { automationName: "Casa e cozinha — manhã" });
  row(5, 1, "queued", 0, { priority: 100 });
  row(7, 0, "queued", 0, { automationName: "Eletrônicos até R$ 150" });
  c.advanceDemo = () => {
    const rows = sn.rows(DEMO_ACCOUNT);
    const sending = rows.find((r) => r.status === "sending");
    if (sending) {
      sn.transition(DEMO_ACCOUNT, sending.id, "sent");
      return;
    }
    const next = rows.filter((r) => r.status === "queued").sort((a, b) => b.priority - a.priority)[0];
    if (next) sn.transition(DEMO_ACCOUNT, next.id, "sending");
  };
  const ad = { automations: c.automations, connections: c.connections };
  await createAutomation(ad, S, { name: "Eletrônicos até R$ 150", days: [0, 1, 2, 3, 4, 5, 6], windowStart: "08:00", windowEnd: "22:00", frequencyMin: 30, filters: { category: "Eletrônicos", minDiscount: 30, minCommission: 5, priceMax: 150, minRating: 4.5 }, header: "Achadinho do dia", footer: "Preço pode mudar a qualquer momento.", groupIds: [ids[0]!] });
  await createAutomation(ad, S, { name: "Casa e cozinha — manhã", days: [1, 2, 3, 4, 5], windowStart: "07:00", windowEnd: "12:00", frequencyMin: 60, filters: { category: "Casa e Cozinha", minDiscount: 25, minCommission: 4, priceMax: 200, minRating: 4.3 }, groupIds: [ids[1]!] });
}

const g = globalThis as { __achadinhos?: Promise<Container> };

export function container(): Promise<Container> {
  g.__achadinhos ??= (async () => {
    const connections = new MemoryConnections();
    const sendNow = new MemorySendNow(connections);
    const c: Container = {
      connections,
      automations: new MemoryAutomations(),
      vault: new MemoryVault(),
      telegram: DEMO() ? demoTelegram : createTelegramGateway(),
      sessions,
      sendNow,
      sends: sendNow,
      finder: DEMO() ? demoFinder : offlineFinder,
      links: DEMO() ? demoLinks : offlineLinks,
    };
    if (DEMO()) await seed(c);
    return c;
  })();
  return g.__achadinhos;
}

/** Para telas: sessão da requisição; no demo, `?vazio=1` mostra a conta sem dados (somente leitura de preview). */
export async function viewSession(c: Container, vazio: boolean): Promise<Session | null> {
  const s = await c.sessions.current();
  if (s && DEMO() && vazio) return { accountId: DEMO_EMPTY_ACCOUNT, userId: s.userId };
  return s;
}
