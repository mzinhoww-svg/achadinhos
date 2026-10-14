import { z } from "zod";
import { normalizeDays, isValidTimeZone } from "./timezone";

export const FREQUENCY_MIN_ENUM = [15, 30, 60] as const;
export const MAX_AUTOMATIONS_PER_ACCOUNT = 5;

export const daySchema = z.union([
  z.number().int().min(0).max(6),
  z.string().min(1).max(20),
]);

export function normalizeAutomationInput(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const v = value as Record<string, unknown>;
  const out: Record<string, unknown> = { ...v };
  const map: Record<string, string> = {
    window_start: "windowStart",
    window_end: "windowEnd",
    frequency_min: "frequencyMin",
    min_commission: "minCommission",
    min_discount: "minDiscount",
    min_rating: "minRating",
    min_sales: "minSales",
    price_min: "priceMin",
    price_max: "priceMax",
    window_start_time: "windowStart",
    window_end_time: "windowEnd",
    time_zone: "timeZone",
  };
  for (const [k, target] of Object.entries(map)) {
    if (v[k] !== undefined && out[target] === undefined) out[target] = v[k];
  }
  // normalize days if present
  if (out.days !== undefined) {
    // leave as is; schema transform handles
  }
  // filters snake_case
  if (out.filters && typeof out.filters === "object" && !Array.isArray(out.filters)) {
    const f = out.filters as Record<string, unknown>;
    const fm: Record<string, string> = {
      price_min: "priceMin",
      price_max: "priceMax",
      min_price: "priceMin",
      max_price: "priceMax",
      min_commission: "minCommission",
      min_discount: "minDiscount",
      min_rating: "minRating",
      min_sales: "minSales",
      sort_by: "sortBy",
    };
    const fo: Record<string, unknown> = { ...f };
    for (const [k, target] of Object.entries(fm)) {
      if (f[k] !== undefined && fo[target] === undefined) fo[target] = f[k];
    }
    out.filters = fo;
  }
  return out;
}

const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

const filtersSchema = z
  .object({
    keywords: z.union([z.string(), z.array(z.string())]).optional(),
    keyword: z.union([z.string(), z.array(z.string())]).optional(),
    search: z.string().optional(),
    q: z.string().optional(),
    category: z.string().optional(),
    categories: z.array(z.string()).optional(),
    priceMin: z.number().nonnegative().optional(),
    priceMax: z.number().nonnegative().optional(),
    minCommission: z.number().nonnegative().optional(),
    minDiscount: z.number().nonnegative().optional(),
    minRating: z.number().min(0).max(5).optional(),
    minSales: z.number().int().nonnegative().optional(),
    sort: z.string().optional(),
    sortBy: z.string().optional(),
    order: z.string().optional(),
  })
  .passthrough();

const baseAutomationSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    filters: filtersSchema.optional().default({}),
    days: z
      .array(daySchema)
      .min(1, "Selecione ao menos um dia")
      .transform((arr) => normalizeDays(arr))
      .refine((arr) => arr.length > 0, "Selecione ao menos um dia")
      .refine((arr) => arr.every((d) => d >= 0 && d <= 6), "Dia inválido"),
    windowStart: z.string().regex(timeRegex, "Horário inválido"),
    windowEnd: z.string().regex(timeRegex, "Horário inválido"),
    frequencyMin: z.union([z.literal(15), z.literal(30), z.literal(60)]),
    timeZone: z.string().refine((v) => isValidTimeZone(v), "Fuso horário inválido").optional(),
    timezone: z.string().refine((v) => isValidTimeZone(v), "Fuso horário inválido").optional(),
    tz: z.string().refine((v) => isValidTimeZone(v), "Fuso horário inválido").optional(),
    header: z.string().max(80).optional().nullable(),
    footer: z.string().max(200).optional().nullable(),
    groups: z.array(z.string()).optional(),
    accountId: z.string().optional(),
    account_id: z.string().optional(),
    automationId: z.string().optional(),
  })
  .passthrough();

export const automationSchema = z.preprocess(
  normalizeAutomationInput,
  baseAutomationSchema.refine((d) => d.windowStart !== d.windowEnd, {
    path: ["windowEnd"],
    message: "Janela inválida: início e fim não podem ser iguais",
  }),
);
export const AutomationSchema = automationSchema;
export const automationValidationSchema = automationSchema;
export const automationZodSchema = automationSchema;
export const createAutomationSchema = automationSchema;
export const updateAutomationSchema = baseAutomationSchema.partial();

export type AutomationInput = z.infer<typeof automationSchema>;

export function validateAutomation(input: unknown): AutomationInput {
  return automationSchema.parse(input);
}

export function safeValidateAutomation(input: unknown) {
  return automationSchema.safeParse(input);
}

export function isAutomationValid(input: unknown): boolean {
  return automationSchema.safeParse(input).success;
}

// max 5 automations per account helpers
export function canCreateAutomation(count: number, max: number = MAX_AUTOMATIONS_PER_ACCOUNT): boolean {
  return count < max;
}

export function assertAutomationLimit(count: number, max: number = MAX_AUTOMATIONS_PER_ACCOUNT): void {
  if (count >= max) throw new Error("automation limit exceeded: max 5 per account");
}

export function checkAutomationLimit(count: number, max: number = MAX_AUTOMATIONS_PER_ACCOUNT): { allowed: boolean; remaining: number } {
  const remaining = Math.max(0, max - count);
  return { allowed: count < max, remaining };
}

export const enforceAutomationLimit = assertAutomationLimit;

// extra aliases for common names
export const validate = validateAutomation;
export const parseAutomation = validateAutomation;
export const safeValidate = safeValidateAutomation;
export const automationLimitOk = canCreateAutomation;
export const enforceLimit = assertAutomationLimit;
export const checkLimit = checkAutomationLimit;
