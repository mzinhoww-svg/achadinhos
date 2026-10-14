import { MAX_AUTOMATIONS_PER_ACCOUNT, automationSchema, estimatePostsPerDay } from "@achadinhos/domain";
import { z } from "zod";
import { AutomationLimitError, type AutomationDraft, type AutomationRecord, type AutomationsRepo, type ConnectionsRepo } from "./ports";
import { ActionError, type Session } from "./session";

export interface AutomationDeps {
  automations: AutomationsRepo;
  connections: ConnectionsRepo;
}

const idSchema = z.object({ id: z.string().min(1).max(64) });

export function estimateFor(input: { groups: number; windowStart: string; windowEnd: string; frequencyMin: 15 | 30 | 60; dailyCap?: number }) {
  return estimatePostsPerDay(input);
}

async function toDraft(deps: AutomationDeps, session: Session, input: unknown): Promise<AutomationDraft> {
  const parsed = automationSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0] ?? "_")] ??= i.message;
    throw new ActionError("invalid", "Confira os campos.", fieldErrors);
  }
  const v = parsed.data as Record<string, unknown> & { name?: string; days: number[]; windowStart: string; windowEnd: string; frequencyMin: 15 | 30 | 60 };
  if (!v.name?.trim()) throw new ActionError("invalid", "Confira os campos.", { name: "Dê um nome para reconhecer a automação." });
  const groupIds = z.array(z.string().max(64)).max(50).parse((input as { groupIds?: unknown })?.groupIds ?? []);
  const owned = new Set((await deps.connections.listGroups(session.accountId)).filter((g) => g.active).map((g) => g.id));
  if (groupIds.some((id) => !owned.has(id))) {
    throw new ActionError("invalid", "Confira os campos.", { groupIds: "Escolha só grupos ativos da sua conta." });
  }
  return {
    name: v.name.trim(),
    status: "active",
    filters: (v.filters as Record<string, unknown>) ?? {},
    days: v.days,
    windowStart: v.windowStart,
    windowEnd: v.windowEnd,
    frequencyMin: v.frequencyMin,
    header: (v.header as string | null | undefined) ?? null,
    footer: (v.footer as string | null | undefined) ?? null,
    groupIds,
  };
}

export async function createAutomation(deps: AutomationDeps, session: Session, input: unknown): Promise<AutomationRecord> {
  const draft = await toDraft(deps, session, input);
  try {
    return await deps.automations.createWithinLimit(session.accountId, draft, MAX_AUTOMATIONS_PER_ACCOUNT);
  } catch (e) {
    if (e instanceof AutomationLimitError) {
      throw new ActionError("limit", `Limite de ${MAX_AUTOMATIONS_PER_ACCOUNT} automações atingido. Exclua uma para criar outra.`);
    }
    throw e;
  }
}

export async function updateAutomation(deps: AutomationDeps, session: Session, input: unknown): Promise<AutomationRecord> {
  const { id } = idSchema.parse({ id: (input as { id?: unknown })?.id });
  const draft = await toDraft(deps, session, input);
  const rec = await deps.automations.update(session.accountId, id, draft);
  if (!rec) throw new ActionError("not_found", "Automação não encontrada.");
  return rec;
}

export async function deleteAutomation(deps: AutomationDeps, session: Session, input: unknown): Promise<{ id: string }> {
  const { id } = idSchema.parse(input);
  if (!(await deps.automations.remove(session.accountId, id))) throw new ActionError("not_found", "Automação não encontrada.");
  return { id };
}

export async function listAutomations(deps: AutomationDeps, session: Session): Promise<AutomationRecord[]> {
  return deps.automations.list(session.accountId);
}
