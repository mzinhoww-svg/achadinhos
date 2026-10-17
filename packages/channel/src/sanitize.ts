/**
 * Neutralização de texto externo (§1 regra 5). Título, `text` e rótulo do grupo são dados da
 * Shopee/configuração: podem forjar markdown, mas nunca caminho nem estrutura do artefato.
 */

/** Caracteres de controle C0/C1 (inclui `\n`, `\r` e `\t`). */
const C0_C1 = /[\u0000-\u001F\u007F-\u009F]/g;
/** Separadores de linha/parágrafo Unicode. */
const LINE_SEPARATORS = /[\u2028\u2029]/g;
/** Controles de direção (bidi) que reordenam a exibição. */
const BIDI = /[\u202A-\u202E\u2066-\u2069]/g;
/** Metacaracteres de markdown que reinterpretamos como texto literal. */
const MARKDOWN_SPECIALS = /([\\`|\[\]<>*_])/g;

export const MAX_TITLE_LENGTH = 500;

export function truncateCodepoints(value: string, maxLength: number): string {
  const chars = Array.from(value);
  return chars.length <= maxLength ? value : chars.slice(0, maxLength).join("");
}

/**
 * Quebra de linha/retorno de carro viram espaço (mantêm a separação sem criar linhas);
 * os demais controles C0/C1 somem; separadores Unicode e bidi somem.
 */
export function neutralizeExternal(value: string): string {
  return value.replace(/[\r\n]/g, " ").replace(C0_C1, "").replace(LINE_SEPARATORS, "").replace(BIDI, "");
}

/** Controles C0/C1 exceto `\n` (0x0A), que é a quebra de linha legítima do `text`. */
const C0_C1_EXCEPT_NEWLINE = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g;

/**
 * Texto multilinha (`text`): preserva `\n` (dentro do bloco cercado ele não cria estrutura),
 * normaliza `\r\n`/`\r` para `\n` e remove os demais controles, separadores e bidi.
 */
export function neutralizeMultilineText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(C0_C1_EXCEPT_NEWLINE, "")
    .replace(LINE_SEPARATORS, "")
    .replace(BIDI, "");
}

/**
 * Escapa os metacaracteres de markdown e neutraliza marcadores no início da linha/string
 * (`---`, `#`) para que o dado externo nunca vire estrutura. `>` já sai escapado pelo passo anterior.
 */
function escapeMarkdown(value: string): string {
  const escaped = value.replace(MARKDOWN_SPECIALS, "\\$1");
  return escaped.replace(/^(\s*)(-{3,}|#)/, "$1\\$2");
}

/** Título exibível: neutralizado, limitado a `MAX_TITLE_LENGTH` caracteres e escapado. */
export function sanitizeTitle(value: string): string {
  return escapeMarkdown(truncateCodepoints(neutralizeExternal(value), MAX_TITLE_LENGTH));
}

/** Texto corrido exibível: neutralizado e escapado (sem teto de tamanho). */
export function sanitizeText(value: string): string {
  return escapeMarkdown(neutralizeExternal(value));
}

/** Remove U+2028/U+2029 antes de `JSON.stringify` (alguns parsers YAML os tratam como quebra). */
export function stripLineSeparators(value: string): string {
  return value.replace(LINE_SEPARATORS, "");
}
