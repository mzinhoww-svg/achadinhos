import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

describe("T8-06 superfície (checklist C)", () => {
  it.each(["components/send-now-panel.tsx", "app/mandar-agora/page.tsx"])("%s renderiza conteúdo da Shopee como texto", (f) => {
    expect(read(f)).not.toMatch(/dangerouslySetInnerHTML/);
  });
  it("módulos que tocam a Shopee importam server-only", () => {
    for (const f of ["server/send-now.ts", "server/shopee-finder.ts"]) expect(read(f)).toContain('import "server-only"');
  });
  it("toda Server Action de Mandar agora passa pela guarda", () => {
    const src = read("app/mandar-agora/actions.ts");
    expect(src).toContain("guarded");
    expect(src).not.toMatch(/accountId|account_id/);
  });
  it("a UI nunca monta status/prioridade do envio", () => {
    expect(read("components/send-now-panel.tsx")).not.toMatch(/priority|status:\s*["']queued/);
  });
});
