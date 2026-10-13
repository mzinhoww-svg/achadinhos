export const DEFAULT_TIMEZONE = "America/Cuiaba";
export const REPEATED_REASON = "repetida";

const DAY_NAME_MAP: Record<string, number> = {
  sun: 0,
  dom: 0,
  sunday: 0,
  domingo: 0,
  mon: 1,
  seg: 1,
  monday: 1,
  segunda: 1,
  tue: 2,
  ter: 2,
  tuesday: 2,
  terca: 2,
  "terça": 2,
  wed: 3,
  qua: 3,
  wednesday: 3,
  quarta: 3,
  thu: 4,
  qui: 4,
  thursday: 4,
  quinta: 4,
  fri: 5,
  sex: 5,
  friday: 5,
  sexta: 5,
  sat: 6,
  sab: 6,
  saturday: 6,
  sábado: 6,
  sabado: 6,
};

export function normalizeDay(value: unknown): number | null {
  if (typeof value === "number") {
    if (!Number.isInteger(value)) return null;
    if (value === 7) return 0;
    if (value < 0 || value > 6) return null;
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase();
    if (trimmed in DAY_NAME_MAP) return DAY_NAME_MAP[trimmed] ?? null;
    const n = Number(trimmed);
    if (Number.isInteger(n)) return normalizeDay(n);
    return null;
  }
  return null;
}

export function normalizeDays(values: unknown): number[] {
  const input = Array.isArray(values) ? values : values == null ? [] : [values];
  const out: number[] = [];
  for (const v of input) {
    const n = normalizeDay(v);
    if (n !== null && !out.includes(n)) out.push(n);
  }
  return out;
}

export function getTimeZoneOffsetMs(timeZone: string, instant: Date): number {
  try {
    const tzStr = instant.toLocaleString("en-US", { timeZone });
    const utcStr = instant.toLocaleString("en-US", { timeZone: "UTC" });
    const tz = Date.parse(tzStr);
    const utc = Date.parse(utcStr);
    if (Number.isNaN(tz) || Number.isNaN(utc)) return 0;
    return tz - utc;
  } catch {
    return 0;
  }
}

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
  weekday: number; // 0=Sun..6=Sat
  dateKey: string; // YYYY-MM-DD
  minutesOfDay: number;
}

export function getZonedParts(date: Date | string | number, timeZone: string = DEFAULT_TIMEZONE): ZonedParts {
  const instant = date instanceof Date ? date : new Date(date);
  const dt = Number.isNaN(instant.getTime()) ? new Date(0) : instant;
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const parts = fmt.formatToParts(dt);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const year = Number(get("year"));
  const month = Number(get("month"));
  const day = Number(get("day"));
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));
  const second = Number(get("second"));
  const ms = dt.getMilliseconds();
  const wdName = get("weekday");
  const wdMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekday = wdMap[wdName] ?? new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    millisecond: ms,
    weekday,
    dateKey: `${year}-${mm}-${dd}`,
    minutesOfDay: hour * 60 + minute,
  };
}

export function wallToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): Date {
  const wallMs = Date.UTC(year, month - 1, day, hour, minute, second, 0);
  const approx = wallMs;
  const offset = getTimeZoneOffsetMs(timeZone, new Date(approx));
  return new Date(wallMs - offset);
}

function toMin(v: string): number {
  const parts = v.split(":");
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

export interface WindowConfig {
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

export function resolveWindow(cfg: WindowConfig): { start: string; end: string; freq: number; days: number[]; tz: string } {
  const start = cfg.windowStart ?? cfg.window_start ?? cfg.start ?? "00:00";
  const end = cfg.windowEnd ?? cfg.window_end ?? cfg.end ?? "00:00";
  const freqRaw = cfg.frequencyMin ?? cfg.frequency_min ?? cfg.frequency ?? 30;
  const freq = freqRaw === 15 || freqRaw === 30 || freqRaw === 60 ? freqRaw : 30;
  const days = normalizeDays(cfg.days ?? cfg.weekdays ?? cfg.daysOfWeek ?? []);
  const tz = cfg.timeZone ?? cfg.timezone ?? cfg.tz ?? DEFAULT_TIMEZONE;
  return { start, end, freq, days: days.length ? days : [0, 1, 2, 3, 4, 5, 6], tz };
}

export function isWithinWindow(date: Date | string | number, cfg: WindowConfig): boolean {
  const { start, end, days, tz } = resolveWindow(cfg);
  const parts = getZonedParts(date, tz);
  const s = toMin(start);
  const e = toMin(end);
  const m = parts.minutesOfDay;
  // days: cross-midnight early portion belongs to previous day
  if (s < e) {
    if (!days.includes(parts.weekday)) return false;
    return m >= s && m < e;
  }
  if (s > e) {
    if (m >= s) return days.includes(parts.weekday);
    if (m < e) {
      const prevDay = (parts.weekday + 6) % 7;
      return days.includes(prevDay);
    }
    return false;
  }
  // s === e: full day only if all days? treat as never? We'll treat as whole day when included
  return days.includes(parts.weekday);
}

export const isInsideWindow = isWithinWindow;
export const inWindow = isWithinWindow;
