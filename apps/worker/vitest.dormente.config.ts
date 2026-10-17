import { defineConfig } from "vitest/config";

/**
 * Suíte DORMENTE do worker: roda TODOS os testes (sem a allowlist do `vitest.config.ts`).
 * Usada pelo workflow `.github/workflows/dormente.yml` para revalidar o que saiu da CI
 * padrão (ver docs/plans/escopo-sem-supabase-telegram.md §2).
 */
export default defineConfig({
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
