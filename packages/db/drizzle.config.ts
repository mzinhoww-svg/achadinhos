import { defineConfig } from "drizzle-kit";

// Só gera SQL a partir do schema (pnpm db:gerar). Quem aplica é o worker, no boot (src/migrar.ts).
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  schemaFilter: ["achadinhos"],
});
