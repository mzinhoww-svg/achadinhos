import MarkdownIt from "markdown-it";

/**
 * Markdown da bíblia para HTML. `html: false` escapa qualquer HTML do texto e o validador padrão
 * recusa links javascript:/vbscript:/data:, então o resultado é seguro para dangerouslySetInnerHTML.
 */
const md = new MarkdownIt({ html: false, linkify: true, typographer: false });

export function markdownParaHtml(texto: string): string {
  return md.render(texto);
}
