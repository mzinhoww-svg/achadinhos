import type { Slot } from "@achadinhos/channel";
import { DEFAULT_TIMEZONE, getZonedParts } from "@achadinhos/domain";

const pad = (value: number): string => String(value).padStart(2, "0");

/**
 * Fonte única de tempo (§1 B1): o `Slot` é calculado UMA vez por execução, no início, a partir do
 * relógio da conta. O canal não calcula tempo — só valida o formato.
 */
export function slotForRun(runStartedAt: Date, groupIndex: number, timeZone: string = DEFAULT_TIMEZONE): Slot {
  if (!(runStartedAt instanceof Date) || Number.isNaN(runStartedAt.getTime())) {
    throw new RangeError("runStartedAt inválido");
  }
  if (!Number.isInteger(groupIndex) || groupIndex < 1 || groupIndex > 99) {
    throw new RangeError("groupIndex fora de 1..99");
  }
  const parts = getZonedParts(runStartedAt, timeZone);
  return {
    day: `${parts.year}${pad(parts.month)}${pad(parts.day)}`,
    hhmm: `${pad(parts.hour)}${pad(parts.minute)}`,
    groupIndex,
  };
}
