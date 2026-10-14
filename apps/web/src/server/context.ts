import "server-only";
import { MemoryAutomations, MemoryConnections, MemoryVault } from "./memory";
import type { AutomationsRepo, ConnectionsRepo, SecretVault, TelegramGateway } from "./ports";
import { createTelegramGateway } from "./telegram-gateway";
import type { Session, SessionProvider } from "./session";

export interface Container {
  connections: ConnectionsRepo;
  automations: AutomationsRepo;
  vault: SecretVault;
  telegram: TelegramGateway;
  sessions: SessionProvider;
}

const DEMO = () => process.env.ACHADINHOS_DEMO_SESSION === "1";
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
  const ad = { automations: c.automations, connections: c.connections };
  await createAutomation(ad, S, { name: "Eletrônicos até R$ 150", days: [0, 1, 2, 3, 4, 5, 6], windowStart: "08:00", windowEnd: "22:00", frequencyMin: 30, filters: { category: "Eletrônicos", minDiscount: 30, minCommission: 5, priceMax: 150, minRating: 4.5 }, header: "Achadinho do dia", footer: "Preço pode mudar a qualquer momento.", groupIds: [ids[0]!] });
  await createAutomation(ad, S, { name: "Casa e cozinha — manhã", days: [1, 2, 3, 4, 5], windowStart: "07:00", windowEnd: "12:00", frequencyMin: 60, filters: { category: "Casa e Cozinha", minDiscount: 25, minCommission: 4, priceMax: 200, minRating: 4.3 }, groupIds: [ids[1]!] });
}

const g = globalThis as { __achadinhos?: Promise<Container> };

export function container(): Promise<Container> {
  g.__achadinhos ??= (async () => {
    const c: Container = {
      connections: new MemoryConnections(),
      automations: new MemoryAutomations(),
      vault: new MemoryVault(),
      telegram: DEMO() ? demoTelegram : createTelegramGateway(),
      sessions,
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
