import {
  MAX_TITLE_LENGTH,
  neutralizeExternal,
  sanitizeTitle,
  stripLineSeparators,
  truncateCodepoints,
} from "./sanitize";
import type { OutboundOffer } from "./types";

/** Controles, separadores Unicode e bidi que não podem sobreviver dentro do artefato. */
const FORBIDDEN_LINK_CHARS = /[\u0000-\u001F\u007F-\u009F\u2028\u2029\u202A-\u202E\u2066-\u2069]/g;

/**
 * URL já aprovada por `isAllowedLink`: renormaliza pelo parser (`new URL` remove tabs/quebras)
 * e limpa resíduos de controle, para que a URL não consiga forjar linhas ou estrutura markdown.
 */
export function normalizeAffiliateLink(raw: string): string {
  return new URL(raw).href.replace(FORBIDDEN_LINK_CHARS, "");
}

function formatPrice(value: number): string {
  return `R$ ${value.toFixed(2)}`;
}

/** Maior sequência contígua de crases no valor. */
function longestBacktickRun(value: string): number {
  let longest = 0;
  let current = 0;
  for (const char of value) {
    current = char === "`" ? current + 1 : 0;
    if (current > longest) longest = current;
  }
  return longest;
}

/**
 * Mensagem pronta para copiar: neutralizada (controles, separadores, bidi) mas **sem escape** de
 * markdown, dentro de um bloco cercado por crases. O fence tem `maior sequência de crases do texto + 1`
 * (mínimo 3), então `*negrito*`, `_itálico_` e crases saem literais sem fechar o bloco.
 */
export function renderTextBlock(rawText: string): string {
  const text = neutralizeExternal(rawText);
  const fence = "`".repeat(Math.max(3, longestBacktickRun(text) + 1));
  return [fence, text, fence].join("\n");
}

/**
 * Artefato `.md` de um slot: front matter JSON (uma linha, U+2028/U+2029 removidos) como dado
 * legível por máquina, e corpo markdown com o texto externo já neutralizado.
 */
export function renderOfferMarkdown(offer: OutboundOffer, slotKey: string): string {
  // Regra 6: o link gravado em qualquer lugar do `.md` é o normalizado, nunca o texto cru recebido.
  const affiliateLink = normalizeAffiliateLink(offer.affiliateLink);
  const frontMatter = stripLineSeparators(
    JSON.stringify({
      slot: { day: offer.slot.day, hhmm: offer.slot.hhmm, groupIndex: offer.slot.groupIndex },
      itemId: offer.itemId,
      // título cru (o JSON cuida da citação); limitado para não inflar o arquivo. Quem exibe, sanitiza.
      title: truncateCodepoints(offer.title, MAX_TITLE_LENGTH),
      affiliateLink,
      priceCurrent: offer.priceCurrent,
      priceOld: offer.priceOld,
      discountPct: offer.discountPct,
      generatedAtUtc: offer.generatedAtUtc,
      groupLabel: offer.groupLabel,
    }),
  );

  const body = [
    `# ${sanitizeTitle(offer.title)}`,
    "",
    affiliateLink,
    "",
    `${formatPrice(offer.priceCurrent)} (era ${formatPrice(offer.priceOld)}) — ${offer.discountPct}% de desconto`,
    "",
    renderTextBlock(offer.text),
    "",
    `- slot: ${slotKey}`,
    `- grupo: ${sanitizeTitle(offer.groupLabel)}`,
    `- gerado em: ${offer.generatedAtUtc}`,
  ];

  return ["---", frontMatter, "---", "", ...body, ""].join("\n");
}

export interface DayIndexRow {
  hhmm: string;
  itemId: string;
  groupIndex: number;
  title: string;
}

/**
 * `index.md` do dia: tabela reconstruída a partir da listagem da pasta. Só colunas e separadores
 * nossos; a célula do título recebe o mesmo tratamento do corpo (senão um `|` externo viraria coluna).
 */
export function renderDayIndex(day: string, rows: DayIndexRow[]): string {
  return [
    `# Outbox ${day}`,
    "",
    "| hhmm | item | grupo | título |",
    "| --- | --- | --- | --- |",
    ...rows.map((row) => `| ${row.hhmm} | ${row.itemId} | ${row.groupIndex} | ${sanitizeTitle(row.title)} |`),
    "",
  ].join("\n");
}
