import { describe, expect, it } from "vitest";
import { DOCS_BIBLIA, gravarDocBiblia, slugBiblia } from "./biblia.ts";

describe("bíblia", () => {
  it("tem os 11 documentos do pacote", () => {
    expect(DOCS_BIBLIA).toHaveLength(11);
  });
  it("normaliza o slug", () => {
    expect(slugBiblia.parse("tom-de-voz.md")).toBe("TOM-DE-VOZ");
    expect(() => slugBiblia.parse("../etc")).toThrow();
  });
  it("exige autor e conteúdo", () => {
    expect(gravarDocBiblia.safeParse({ slug: "BIBLIA", conteudo: "", autor: "x" }).success).toBe(false);
    expect(gravarDocBiblia.safeParse({ slug: "BIBLIA", conteudo: "v1", autor: "Coordenador" }).success).toBe(
      true,
    );
  });
});
