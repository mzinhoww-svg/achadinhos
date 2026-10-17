import { defineConfig } from "vitest/config";

/**
 * Suíte DORMENTE da commission: roda TODOS os testes, inclusive `src/sql/**`
 * (sem o exclude do `vitest.config.ts`). Usada pelo workflow dormente.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
