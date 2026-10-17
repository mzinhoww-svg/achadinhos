import { describe, expect, it } from "vitest";
import {
  MAX_TITLE_LENGTH,
  neutralizeMultilineText,
  sanitizeText,
  sanitizeTitle,
  stripLineSeparators,
} from "../sanitize";

describe("neutralização de texto externo (§1 regra 5)", () => {
  it("quebra de linha vira espaço e demais controles somem", () => {
    expect(sanitizeText("a\nb\rc\u0000d\u0007e")).toBe("a b cde");
  });

  it("remove U+2028/U+2029 e controles bidi", () => {
    expect(sanitizeText("a\u2028b\u2029c\u202Ed\u2066f")).toBe("abcdf");
  });

  it("escapa metacaracteres de markdown", () => {
    expect(sanitizeText("| ` [x](http://evil) * _ <b> \\")).toBe(
      "\\| \\` \\[x\\](http://evil) \\* \\_ \\<b\\> \\\\",
    );
  });

  it("neutraliza início de linha/string com ---, # e >", () => {
    expect(sanitizeText("---")).toBe("\\---");
    expect(sanitizeText("# titulo")).toBe("\\# titulo");
    expect(sanitizeText("> cita")).toBe("\\> cita");
    expect(sanitizeText("  # titulo")).toBe("  \\# titulo");
  });

  it("título é limitado a MAX_TITLE_LENGTH caracteres", () => {
    expect(MAX_TITLE_LENGTH).toBe(500);
    const truncated = sanitizeTitle("a".repeat(10_000));
    expect(Array.from(truncated).length).toBe(MAX_TITLE_LENGTH);
  });

  it("emoji é preservado", () => {
    expect(sanitizeTitle("🔥 promo")).toBe("🔥 promo");
  });

  it("texto multilinha preserva \\n e normaliza \\r\\n/\\r", () => {
    expect(neutralizeMultilineText("a\r\nb\rc\nd")).toBe("a\nb\nc\nd");
    expect(neutralizeMultilineText("a\u0000b\u0007c\u2028d\u202Ee")).toBe("abcde");
    expect(neutralizeMultilineText("a\nb")).toBe("a\nb");
  });

  it("stripLineSeparators remove os separadores Unicode", () => {
    expect(stripLineSeparators('{"a":"x\u2028y\u2029z"}')).toBe('{"a":"xyz"}');
  });
});
