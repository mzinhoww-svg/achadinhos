export type FrequencyMin = 15 | 30 | 60;

export interface EstimateInput {
  groups?: number;
  groupCount?: number;
  numberOfGroups?: number;
  windowStart?: string;
  window_start?: string;
  start?: string;
  windowEnd?: string;
  window_end?: string;
  end?: string;
  frequencyMin?: FrequencyMin;
  frequency_min?: number;
  frequency?: number;
  dailyCap?: number;
  daily_cap?: number;
  cap?: number;
}

export function toMinutesOfDay(value: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return 0;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return 0;
  if (h < 0 || h > 23 || min < 0 || min > 59) return 0;
  return h * 60 + min;
}

/** Duração da janela em minutos, tratando janela que cruza meia-noite. */
export function windowMinutes(start: string, end: string): number {
  const s = toMinutesOfDay(start);
  const e = toMinutesOfDay(end);
  if (e > s) return e - s;
  if (e < s) return 24 * 60 - s + e;
  return 0;
}

export const minutesBetween = windowMinutes;

export function estimatePostsPerDay(input: EstimateInput): { raw: number; capped: number; hitCap: boolean } {
  const groups =
    input.groups ?? input.groupCount ?? input.numberOfGroups ?? 0;
  const start = input.windowStart ?? input.window_start ?? input.start ?? "00:00";
  const end = input.windowEnd ?? input.window_end ?? input.end ?? "00:00";
  const freq = (input.frequencyMin ?? input.frequency_min ?? input.frequency ?? 30) as number;
  const cap = input.dailyCap ?? input.daily_cap ?? input.cap ?? 200;
  const safeGroups = Math.max(0, Number(groups) || 0);
  const safeFreq = freq === 15 || freq === 30 || freq === 60 ? freq : 30;
  const mins = windowMinutes(start, end);
  const raw = safeGroups * Math.floor(mins / safeFreq);
  const safeRaw = Math.max(0, raw);
  const safeCap = Math.max(0, Number(cap) || 0);
  return { raw: safeRaw, capped: Math.min(safeRaw, safeCap), hitCap: safeRaw > safeCap };
}

// aliases
export const estimate = estimatePostsPerDay;
export const calculateEstimate = estimatePostsPerDay;
export const postsPerDay = estimatePostsPerDay;
