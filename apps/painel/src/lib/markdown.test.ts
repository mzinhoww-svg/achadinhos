import { describe, expect, it } from "vitest";
import { markdownParaHtml } from "./markdown";

describe("markdown", () => {
  it("renderiza tabelas e listas", () => {
    const h = markdownParaHtml("- a\n\n| x | y |\n|---|---|\n| 1 | 2 |");
    expect(h).toContain("<li>a</li>");
    expect(h).toContain("<table>");
  });
  it("escapa HTML e recusa links perigosos", () => {
    const h = markdownParaHtml(
      "<script>alert(1)</script> [x](javascript:alert(1)) <img src=x onerror=alert(1)>",
    );
    expect(h).not.toContain("<script>");
    expect(h).not.toContain("<img");
    expect(h).not.toContain('href="javascript:');
  });
});
