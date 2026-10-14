import { getZonedParts, resolveWindow, wallToUtc, DEFAULT_TIMEZONE, normalizeDays, getTimeZoneOffsetMs } from "./timezone.js";

export interface GroupLike {
  id?: string;
  group_id?: string;
  groupId?: string;
  next_run_at?: Date | string | number | null;
  nextRunAt?: Date | string | number | null;
  active?: boolean;
  is_active?: boolean;
  isActive?: boolean;
}

export interface AutomationConfig extends Record<string, unknown> {
  windowStart?: string;
  window_start?: string;
  start?: string;
  windowEnd?: string;
  window_end?: string;
  end?: string;
  frequencyMin?: number;
  frequency_min?: number;
  frequency?: number;
  days?: unknown;
  weekdays?: unknown;
  daysOfWeek?: unknown;
  timeZone?: string;
  timezone?: string;
  tz?: string;
}

function asDate(v: unknown): Date | null {
  if (v == null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const d = new Date(v as string | number);
  return Number.isNaN(d.getTime()) ? null : d;
}

function anchorMidnightUtc(y: number, m: number, d: number, tz: string): Date {
  const offset = getTimeZoneOffsetMs(tz, new Date(Date.UTC(y, m - 1, d, 12, 0, 0)));
  const wallMid = Date.UTC(y, m - 1, d, 0, 0, 0);
  return new Date(wallMid - offset);
}

function zonedDateAdd(dateKey: string, deltaDays: number): { y: number; m: number; d: number } {
  const parts = dateKey.split("-").map(Number);
  const y = parts[0] ?? 0;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

function weekdayOfDateKey(dateKey: string): number {
  const parts = dateKey.split("-").map(Number);
  const y = parts[0] ?? 0;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function _calculateNextRunAtStrict(
  now: Date | string | number,
  automation: AutomationConfig = {},
): Date {
  const instant = now instanceof Date ? now : new Date(now as string | number);
  const safeNow = Number.isNaN(instant.getTime()) ? new Date() : instant;
  const cfg = resolveWindow(automation as Record<string, unknown>);
  const { start, end, freq, days, tz } = cfg;
  const sMin = Number(start.split(":")[0]) * 60 + Number(start.split(":")[1]);
  const eMin = Number(end.split(":")[0]) * 60 + Number(end.split(":")[1]);
  const duration = sMin < eMin ? eMin - sMin : sMin > eMin ? 24 * 60 - sMin + eMin : 0;
  // slots offsets from start
  const offsets: number[] = [];
  for (let off = 0; off < duration; off += freq) {
    offsets.push(off);
  }
  if (duration <= 0) return safeNow;
  if (offsets.length === 0) offsets.push(0);

  const nowParts = getZonedParts(safeNow, tz);
  // candidate anchor days: from now-1 to now+14
  let best: number | null = null;
  for (let delta = -1; delta <= 14; delta++) {
    const base = zonedDateAdd(nowParts.dateKey, delta);
    const anchorWd = weekdayOfDateKey(
      `${base.y}-${String(base.m).padStart(2, "0")}-${String(base.d).padStart(2, "0")}`,
    );
    if (!days.includes(anchorWd)) continue;
    const midnight = anchorMidnightUtc(base.y, base.m, base.d, tz);
    const anchorMs = midnight.getTime();
    for (const off of offsets) {
      const slotMs = anchorMs + sMin * 60 * 1000 + off * 60 * 1000;
      if (slotMs < safeNow.getTime()) continue;
      if (best === null || slotMs < best) best = slotMs;
    }
  }
  if (best === null) {
    // fallback: tomorrow first
    const tomorrow = zonedDateAdd(nowParts.dateKey, 1);
    const midnight = anchorMidnightUtc(tomorrow.y, tomorrow.m, tomorrow.d, tz);
    return new Date(midnight.getTime() + sMin * 60 * 1000);
  }
  return new Date(best);
}

// placeholders replaced below

export interface ScheduleInput {
  now?: Date | string | number;
  date?: Date | string | number;
  current?: Date | string | number;
  clock?: () => Date;
  automation?: AutomationConfig;
  [key: string]: unknown;
}

function extractNow(input: unknown, ...rest: unknown[]): Date | string | number {
  // If first arg is date-like and second is config
  if (input instanceof Date || typeof input === "string" || typeof input === "number") {
    // could be automation config object disguised? numbers/dates only
    return input as Date | string | number;
  }
  if (input && typeof input === "object") {
    const o = input as Record<string, unknown>;
    if ("now" in o) return o.now as Date | string | number;
    if ("date" in o) return o.date as Date | string | number;
    if ("current" in o) return o.current as Date | string | number;
    if ("asOf" in o) return o.asOf as Date | string | number;
    if (typeof o.clock === "function") return (o.clock as () => Date)();
  }
  if (typeof rest[0] === "function") return (rest[0] as () => Date)();
  return new Date();
}

function extractConfig(input: unknown, ...rest: unknown[]): AutomationConfig {
  if (input && typeof input === "object" && !(input instanceof Date)) {
    const o = input as Record<string, unknown>;
    // if contains window/timezone/days directly, treat as config
    if ("windowStart" in o || "window_start" in o || "start" in o || "days" in o || "frequencyMin" in o || "frequency_min" in o || "tz" in o || "timezone" in o || "timeZone" in o) {
      return o as AutomationConfig;
    }
    // maybe nested automation
    if (o.automation && typeof o.automation === "object") return o.automation as AutomationConfig;
    if (o.config && typeof o.config === "object") return o.config as AutomationConfig;
    if (o.params && typeof o.params === "object") return o.params as AutomationConfig;
  }
  // second argument?
  const r0 = rest.find((r) => r && typeof r === "object" && !(r instanceof Date) && !Array.isArray(r));
  if (r0) return r0 as AutomationConfig;
  return {};
}

// flexible wrapper for calculateNextRunAt supporting (now, config) or (options)
export function nextRunAtFlexible(...args: unknown[]): Date {
  // args may include clock at end
  let nowArg: unknown = undefined;
  let cfgArg: unknown = undefined;
  let clockFn: (() => Date) | undefined;
  for (const a of args) {
    if (typeof a === "function") clockFn = a as () => Date;
    else if (a instanceof Date || typeof a === "string" || typeof a === "number") {
      if (nowArg === undefined) nowArg = a;
    } else if (a && typeof a === "object") {
      const o = a as Record<string, unknown>;
      if ("windowStart" in o || "window_start" in o || "start" in o || "days" in o || "frequencyMin" in o || "frequency_min" in o || "automation" in o || "config" in o || "params" in o) {
        if (cfgArg === undefined) cfgArg = a;
      } else if ("now" in o || "date" in o || "current" in o || "clock" in o) {
        if (nowArg === undefined) nowArg = a;
        if (o.automation && cfgArg === undefined) cfgArg = o.automation;
      } else if (cfgArg === undefined) {
        cfgArg = a;
      }
    }
  }
  const nowResolved = nowArg === undefined ? (clockFn ? clockFn() : new Date()) : nowArg;
  const cfgResolved = (cfgArg ?? {}) as AutomationConfig;
  if (typeof nowResolved === "object" && nowResolved !== null && !(nowResolved instanceof Date)) {
    // options object with now
    return _calculateNextRunAtStrict(extractNow(nowResolved), { ...(cfgResolved as object), ...(nowResolved as object) });
  }
  return _calculateNextRunAtStrict(nowResolved as Date | string | number, cfgResolved);
}

export function isDue(
  group: GroupLike,
  now: Date | string | number = new Date(),
): boolean {
  const t = asDate(group.next_run_at ?? group.nextRunAt);
  if (!t) return false;
  const n = now instanceof Date ? now : new Date(now as string | number);
  return t.getTime() <= n.getTime();
}

export function selectDueGroups(
  groups: GroupLike[],
  now: Date | string | number = new Date(),
): GroupLike[] {
  const n = now instanceof Date ? now : new Date(now as string | number);
  return groups.filter((g) => {
    const active = g.active ?? g.isActive ?? g.is_active ?? true;
    if (active === false) return false;
    const t = asDate(g.next_run_at ?? g.nextRunAt);
    if (!t) return false;
    return t.getTime() <= n.getTime();
  });
}

export const filterDueGroups = selectDueGroups;
export const dueGroups = selectDueGroups;
export const getDueGroups = selectDueGroups;

// advance
export function advanceNextRunAt(group: GroupLike, automation: AutomationConfig, now?: Date | string | number): Date {
  const current = asDate(group.next_run_at ?? group.nextRunAt) ?? new Date();
  const baseNow = now == null ? new Date() : (now instanceof Date ? now : new Date(now as string | number));
  const isMissed = current.getTime() < baseNow.getTime();
  // avança a partir de max(next_run_at, now), pulando slots vencidos
  const searchFrom = isMissed
    ? baseNow
    : new Date(current.getTime() + 1000);
  return _calculateNextRunAtStrict(searchFrom, automation as Record<string, unknown>);
}

export function hasMissedSlot(group: GroupLike, now: Date | string | number = new Date()): boolean {
  const current = asDate(group.next_run_at ?? group.nextRunAt);
  if (!current) return false;
  const n = now instanceof Date ? now : new Date(now as string | number);
  return current.getTime() < n.getTime();
}

export const missedSlot = hasMissedSlot;
export const shouldSkipVencido = hasMissedSlot;

export const advance = advanceNextRunAt;

export const calculateNextRunAt = nextRunAtFlexible;
export const nextRunAt = nextRunAtFlexible;
export const getNextRunAt = nextRunAtFlexible;
export const computeNextRunAt = nextRunAtFlexible;

export const selectDue = selectDueGroups;
export const getDue = selectDueGroups;
export const filterDue = selectDueGroups;
export const findDueGroups = selectDueGroups;
export const isVencido = isDue;
