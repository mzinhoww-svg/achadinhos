import "server-only";
import { publicError } from "./connections";
import type { AutomationsRepo, ConnectionsRepo } from "./ports";
import type { Session } from "./session";

export interface OnboardingDeps {
  connections: ConnectionsRepo;
  automations: AutomationsRepo;
}

export type StepKey = "shopee" | "telegram" | "groups" | "automation";
/** done: concluído · pending: enviado, aguardando validação do worker · error: falhou · todo: falta fazer · blocked: depende de passo anterior. */
export type StepState = "done" | "pending" | "error" | "todo" | "blocked";

export interface OnboardingStep {
  key: StepKey;
  title: string;
  text: string;
  href: string;
  state: StepState;
  /** Complemento de estado (já saneado), ex.: "2 grupos ativos". */
  detail: string | null;
}

export interface Onboarding {
  steps: OnboardingStep[];
  doneCount: number;
  total: number;
  complete: boolean;
  /** Chave do primeiro passo não concluído. */
  next: StepKey | null;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Checklist derivado só do que está no repositório da conta da sessão; nada é lembrado no cliente. */
export async function getOnboarding(deps: OnboardingDeps, session: Session): Promise<Onboarding> {
  const id = session.accountId;
  const [shopee, channel, groups, automations] = await Promise.all([
    deps.connections.getShopee(id),
    deps.connections.getChannel(id),
    deps.connections.listGroups(id),
    deps.automations.list(id),
  ]);

  const fromValidation = (rec: { status: string; lastError: string | null } | null, okDetail: string): { state: StepState; detail: string | null } => {
    if (!rec) return { state: "todo", detail: null };
    if (rec.status === "validated") return { state: "done", detail: okDetail };
    if (rec.status === "invalid") return { state: "error", detail: publicError(rec.lastError) ?? "Credencial recusada. Envie de novo." };
    return { state: "pending", detail: "Validando… leva alguns segundos." };
  };

  const shopeeS = fromValidation(shopee, shopee ? `App ID ${shopee.appId}` : null as never);
  const telegramS = fromValidation(channel, channel ? channel.botName : null as never);
  const active = groups.filter((g) => g.active).length;
  const botReady = telegramS.state === "done";
  const groupsS: { state: StepState; detail: string | null } = !botReady
    ? { state: "blocked", detail: "Conecte o bot primeiro." }
    : active > 0
      ? { state: "done", detail: plural(active, "grupo ativo", "grupos ativos") }
      : { state: "todo", detail: groups.length ? `${plural(groups.length, "grupo encontrado", "grupos encontrados")}, nenhum ativo.` : "Nenhum grupo encontrado. Adicione o bot como admin." };
  const automationS: { state: StepState; detail: string | null } =
    automations.length > 0 ? { state: "done", detail: plural(automations.length, "automação", "automações") } : { state: "todo", detail: null };

  const steps: OnboardingStep[] = [
    { key: "shopee", title: "Conectar a Shopee", text: "App ID e Secret do programa de afiliados.", href: "/conexoes#shopee", ...shopeeS },
    { key: "telegram", title: "Conectar o Telegram", text: "Token do bot criado no @BotFather.", href: "/conexoes#telegram", ...telegramS },
    { key: "groups", title: "Ligar grupos", text: "Cada grupo ativo ganha um sub_id para medir comissão.", href: "/conexoes#telegram", ...groupsS },
    { key: "automation", title: "Criar a primeira automação", text: "Filtros, janela e frequência de postagem.", href: "/automacoes/nova", ...automationS },
  ];
  const doneCount = steps.filter((s) => s.state === "done").length;
  return {
    steps,
    doneCount,
    total: steps.length,
    complete: doneCount === steps.length,
    next: steps.find((s) => s.state !== "done")?.key ?? null,
  };
}
