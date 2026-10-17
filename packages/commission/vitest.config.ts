import { defineConfig } from "vitest/config";

/**
 * Suíte ATIVA da commission (núcleo puro). O adaptador SQL (`src/sql/**`) é dormente
 * (ver docs/plans/escopo-sem-supabase-telegram.md §2 e §4) e é revalidado pela suíte
 * dormente em `vitest.dormente.config.ts` (workflow `.github/workflows/dormente.yml`).
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "src/sql/**"],
    environment: "node",
  },
});
