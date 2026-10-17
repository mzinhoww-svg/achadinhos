import { defineConfig } from "vitest/config";

/**
 * Suíte ATIVA do worker (allowlist).
 *
 * O código dormente (ver docs/plans/escopo-sem-supabase-telegram.md §2) fica fora da
 * CI padrão. Só os testes do caminho ativo rodam aqui; a suíte dormente completa roda
 * em `vitest.dormente.config.ts` (workflow `.github/workflows/dormente.yml`).
 *
 * Quem cria um teste novo do caminho ativo adiciona a linha aqui.
 * Os padrões `tests/paridade.test.ts` e `tests/gerar/**` são do caminho ativo novo
 * (T7-B/T7-A); enquanto não existem, não casam com nada e não quebram a suíte.
 */
export default defineConfig({
  test: {
    include: [
      "tests/image.test.ts",
      "tests/logger.test.ts",
      "tests/scheduler/offer-selection.test.ts",
      "tests/links.test.ts",
      "tests/paridade.test.ts",
      "tests/gerar/**/*.test.ts",
    ],
    environment: "node",
  },
});
