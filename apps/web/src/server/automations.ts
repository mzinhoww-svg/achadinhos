import "server-only";
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

const NUMBER_FILTERS = {
  priceMax: { field: "maxPrice", label: "Preço máximo", min: 0, max: 1_000_000, exclusiveMin: true, int: false },
  minDiscount: { field: "minDiscount", label: "Desconto mínimo", min: 0, max: 100, exclusiveMin: false, int: false },
  minCommission: { field: "minCommission", label: "Comissão mínima", min: 0, max: 100, exclusiveMin: false, int: false },
  minRating: { field: "minRating", label: "Avaliação mínima", min: 0, max: 5, exclusiveMin: false, int: false },
  minSales: { field: "minSales", label: "Vendas mínimas", min: 0, max: 100_000_000, exclusiveMin: false, int: true },
} as const;

/** Valida os filtros numéricos com mensagem por campo. Valor digitado e inválido NUNCA vira "sem filtro". */
function validateFilters(raw: unknown): { filters: Record<string, unknown>; errors: Record<string, string> } {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const filters: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  const category = typeof src.category === "string" ? src.category.trim() : "";
  if (category.length > 60) errors.category = "Categoria: use no máximo 60 caracteres.";
  else if (category) filters.category = category;
  for (const [key, r] of Object.entries(NUMBER_FILTERS)) {
    const v = src[key];
    if (v === undefined || v === null || v === "") continue;
    if (typeof v !== "number" || !Number.isFinite(v)) {
      errors[r.field] = `${r.label}: informe um número válido.`;
    } else if (r.exclusiveMin ? v <= r.min : v < r.min) {
      errors[r.field] = r.exclusiveMin ? `${r.label}: informe um valor maior que zero.` : `${r.label}: use um valor entre ${r.min} e ${r.max}.`;
    } else if (v > r.max) {
      errors[r.field] = `${r.label}: use um valor entre ${r.exclusiveMin ? "0,01" : r.min} e ${r.max}.`;
    } else if (r.int && !Number.isInteger(v)) {
      errors[r.field] = `${r.label}: use um número inteiro.`;
    } else {
      filters[key] = v;
    }
  }
  return { filters, errors };
}

const FIELD_LABEL: Record<string, string> = { name: "Nome", header: "Cabeçalho", footer: "Rodapé", windowStart: "Início da janela", windowEnd: "Fim da janela", frequencyMin: "Frequência", days: "Dias" };

/** Mensagens padrão do zod saem em inglês; aqui viram português por campo. Mensagens já em português do domínio passam. */
function ptMessage(issue: z.ZodIssue): string {
  const label = FIELD_LABEL[String(issue.path[0])] ?? "Campo";
  if (issue.code === "too_small" && issue.type === "string") return issue.minimum === 1 || issue.minimum === 0 ? `${label}: preencha este campo.` : `${label}: use ao menos ${String(issue.minimum)} caracteres.`;
  if (issue.code === "too_big" && issue.type === "string") return `${label}: use no máximo ${String(issue.maximum)} caracteres.`;
  if (issue.path[0] === "frequencyMin") return "Escolha 15, 30 ou 60 minutos.";
  if (/^(Number|String|Array|Invalid|Expected|Required)/.test(issue.message)) return `${label}: valor inválido.`;
  return issue.message;
}

async function toDraft(deps: AutomationDeps, session: Session, input: unknown): Promise<AutomationDraft> {
  const body = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const { filters, errors } = validateFilters(body.filters);
  const parsed = automationSchema.safeParse({ ...body, filters });
  if (!parsed.success) {
    for (const i of parsed.error.issues) {
      const key = i.path[0] === "filters" ? String(i.path[1] ?? "filters") : String(i.path[0] ?? "_");
      errors[key] ??= ptMessage(i);
    }
  }
  if (!parsed.success || Object.keys(errors).length > 0) throw new ActionError("invalid", "Confira os campos.", errors);
  const v = parsed.data as Record<string, unknown> & { name?: string; days: number[]; windowStart: string; windowEnd: string; frequencyMin: 15 | 30 | 60 };
  if (!v.name?.trim()) throw new ActionError("invalid", "Confira os campos.", { name: "Dê um nome para reconhecer a automação." });
  const groupIds = z.array(z.string().max(64)).max(50).parse(body.groupIds ?? []);
  const owned = new Set((await deps.connections.listGroups(session.accountId)).filter((g) => g.active).map((g) => g.id));
  if (groupIds.some((id) => !owned.has(id))) {
    throw new ActionError("invalid", "Confira os campos.", { groupIds: "Escolha só grupos ativos da sua conta." });
  }
  return {
    name: v.name.trim(),
    status: "active",
    filters,
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
  const current = await deps.automations.get(session.accountId, id);
  if (!current) throw new ActionError("not_found", "Automação não encontrada.");
  draft.status = current.status; // editar não reativa uma automação pausada
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
