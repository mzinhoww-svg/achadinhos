export interface EstimateInput {
  groups: number;
  windowStart: string; // "HH:MM"
  windowEnd: string; // "HH:MM"
  frequencyMin: 15 | 30 | 60;
  /** Teto diário por canal (PRD: 200). */
  dailyCap?: number;
}

export function minutesBetween(start: string, end: string): number {
  const toMin = (s: string) => {
    const [h, m] = s.split(":").map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };
  const diff = toMin(end) - toMin(start);
  return diff > 0 ? diff : 0;
}

/** PRD: posts/dia = grupos × (janela em min ÷ frequência), limitado pelo teto diário. */
export function estimatePostsPerDay({ groups, windowStart, windowEnd, frequencyMin, dailyCap = 200 }: EstimateInput) {
  const raw = Math.max(0, groups) * Math.floor(minutesBetween(windowStart, windowEnd) / frequencyMin);
  return { raw, capped: Math.min(raw, dailyCap), hitCap: raw > dailyCap };
}
