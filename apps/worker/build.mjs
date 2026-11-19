// Gera um único arquivo dist/worker.mjs (o deploy não precisa de node_modules) e copia as migrações.
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { build } from "esbuild";

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });
await build({
  entryPoints: ["src/main.ts"],
  outfile: "dist/worker.mjs",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  // pg-native é opcional no pg e não é usado. Os pacotes da Arte têm binários nativos: o deploy instala
  // via npm (veja scripts/empacotar.mjs).
  external: ["pg-native", "sharp", "satori", "@resvg/resvg-js", "ffmpeg-static"],
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: "info",
});
cpSync("../../packages/db/drizzle", "dist/drizzle", { recursive: true });
cpSync("../../packages/arte/fontes", "dist/fontes", { recursive: true });
