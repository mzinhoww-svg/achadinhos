import { defineConfig } from "vitest/config";

/**
 * Testes do ferramental de diagnóstico em `scripts/` (T12).
 * A raiz não é um pacote do workspace, por isso a config própria; o `pnpm test`
 * da raiz encadeia este projeto depois do `pnpm -r`.
 */
export default defineConfig({
  test: {
    include: ["scripts/**/*.test.ts"],
    environment: "node",
  },
});
