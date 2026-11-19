import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AGENTES, type Agente, FERRAMENTAS, ferramentasDe, tokenAgente } from "./ferramentas.js";

const equipe = JSON.parse(
  readFileSync(new URL("../../../../openbot/equipe.json", import.meta.url), "utf8"),
) as {
  agentes: { nome: Agente; ferramentas: string[] }[];
};

describe("ferramentas dos agentes", () => {
  it("openbot/equipe.json tem exatamente as ferramentas que o worker libera para cada agente", () => {
    expect(equipe.agentes.map((a) => a.nome).sort()).toEqual([...AGENTES].sort());
    for (const a of equipe.agentes)
      expect(a.ferramentas.sort()).toEqual(
        ferramentasDe(a.nome)
          .map((f) => f.nome)
          .sort(),
      );
  });
  it("permissão mínima: Garimpeiro só coleta, Disparador só dispara, Coordenador cuida de bíblia, propostas e números", () => {
    const de = (a: Agente) => ferramentasDe(a).map((f) => f.nome);
    expect(de("Garimpeiro")).toContain("buscar_produtos");
    for (const a of AGENTES.filter((x) => x !== "Garimpeiro")) expect(de(a)).not.toContain("buscar_produtos");
    for (const a of AGENTES.filter((x) => x !== "Disparador")) expect(de(a)).not.toContain("agendar_disparo");
    for (const f of [
      "gravar_biblia",
      "decidir_proposta",
      "listar_numeros",
      "promover_numero",
      "definir_pausa",
    ])
      expect(FERRAMENTAS.find((x) => x.nome === f)?.agentes).toEqual(["Coordenador"]);
  });
  it("tokens diferentes por agente e estáveis", () => {
    const t = AGENTES.map((a) => tokenAgente("s".repeat(40), a));
    expect(new Set(t).size).toBe(7);
    expect(tokenAgente("s".repeat(40), "Monitor")).toBe(t[2]);
  });
});
