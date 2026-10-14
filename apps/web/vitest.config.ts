import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  resolve: { alias: { "server-only": fileURLToPath(new URL("./test/stubs/server-only.ts", import.meta.url)), "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { include: ["test/**/*.test.ts"] },
});
