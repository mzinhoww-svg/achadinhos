import { promises as fs } from "node:fs";

import {
  isWithinWindow,
  parseAutomationsConfig,
  type AutomationInput,
  type OfferFilters,
} from "@achadinhos/domain";

import {
  generateOutbox,
  type GenerateDeps,
  type GenerateSummary,
  type GenerateTracking,
} from "./generate.js";

export { AUTOMATIONS_FILE_CODES, type AutomationsFileCode } from "@achadinhos/domain";

/** Caminho padrão do arquivo de automações (só-leitura, editado à mão; sem segredo). */
export const DEFAULT_AUTOMATIONS_FILE = "config/automacoes.json";

export type AutomationsLoadResult =
  | { ok: true; automations: AutomationInput[] }
  | { ok: false; code: string };

/** Lê e valida `config/automacoes.json`. Falha fechado com código fixo (ausente/inválido/limite). */
export async function loadAutomationsFile(
  file: string,
  readFile: (path: string) => Promise<string> = (path) => fs.readFile(path, "utf8"),
): Promise<AutomationsLoadResult> {
  let text: string;
  try {
    text = await readFile(file);
  } catch {
    return { ok: false, code: "automacoes_ausentes" };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, code: "automacoes_invalidas" };
  }
  return parseAutomationsConfig(raw);
}

/** Automações vencidas no instante `now`: a janela e os dias precisam conter o horário (fuso da automação). */
export function selectDueAutomations(
  automations: readonly AutomationInput[],
  now: Date,
): Array<{ automation: AutomationInput; groupIndex: number }> {
  const due: Array<{ automation: AutomationInput; groupIndex: number }> = [];
  automations.forEach((automation, index) => {
    if (isWithinWindow(now, automation)) due.push({ automation, groupIndex: index + 1 });
  });
  return due;
}

export interface AutomationsRunInput {
  runStartedAt: Date;
  affiliateHandle: string;
  imageHosts: readonly string[];
  limit?: number;
  maxPages?: number;
  tracking?: GenerateTracking;
  signal?: AbortSignal;
}

export interface AutomationOutcome {
  name: string;
  groupIndex: number;
  summary: GenerateSummary;
}

export interface AutomationsRunSummary {
  results: AutomationOutcome[];
  delivered: number;
  failed: number;
  unknown: number;
  discarded: number;
}

/**
 * Roda o gerador para cada automação **vencida** no instante da execução. Sem estado: a seleção é só
 * janela+dias (o agendador por frequência depende de persistência e segue adiado, §4). O `groupIndex`
 * é a posição da automação no arquivo (estável), então o arquivo não é misturado entre execuções.
 */
export async function runAutomations(
  automations: readonly AutomationInput[],
  input: AutomationsRunInput,
  deps: GenerateDeps,
): Promise<AutomationsRunSummary> {
  const due = selectDueAutomations(automations, input.runStartedAt);
  const results: AutomationOutcome[] = [];
  for (const { automation, groupIndex } of due) {
    const name = automation.name ?? `Automação ${groupIndex}`;
    const summary = await generateOutbox(
      {
        runStartedAt: input.runStartedAt,
        group: { index: groupIndex, label: name },
        affiliateHandle: input.affiliateHandle,
        imageHosts: input.imageHosts,
        ...(input.limit !== undefined ? { limit: input.limit } : {}),
        ...(input.maxPages !== undefined ? { maxPages: input.maxPages } : {}),
        filters: automation.filters as OfferFilters,
        ...(input.tracking ? { tracking: input.tracking } : {}),
        ...(input.signal ? { signal: input.signal } : {}),
      },
      deps,
    );
    results.push({ name, groupIndex, summary });
    deps.logger.info("automacao", {
      nome: name,
      grupo: groupIndex,
      delivered: summary.delivered,
      failed: summary.failed,
      unknown: summary.unknown,
    });
  }
  const total = (pick: (summary: GenerateSummary) => number) =>
    results.reduce((acc, r) => acc + pick(r.summary), 0);
  return {
    results,
    delivered: total((s) => s.delivered),
    failed: total((s) => s.failed),
    unknown: total((s) => s.unknown),
    discarded: total((s) => s.discarded),
  };
}
