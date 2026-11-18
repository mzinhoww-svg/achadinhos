// Monta as pastas de deploy da Vertra (runtime Node nativo, sem imagem própria):
//   deploy/worker: worker.mjs (arquivo único, sem dependências) + migrações. Start: node worker.mjs
//   deploy/painel: app Next.js autônoma; @achadinhos/shared vai em libs/ como dependência file: (a Vertra remove pastas "vendor" do zip).
//                  A Vertra instala (npm), roda "npm run build" e depois "npm start".
// Uso: pnpm empacotar
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const saida = join(raiz, "deploy");
const ler = (p) => JSON.parse(readFileSync(join(raiz, p), "utf8"));
const gravarJson = (p, v) => writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`);

rmSync(saida, { recursive: true, force: true });

// ---------- worker ----------
execSync("pnpm --filter @achadinhos/worker build", { cwd: raiz, stdio: "inherit" });
const dw = join(saida, "worker");
mkdirSync(dw, { recursive: true });
cpSync(join(raiz, "apps/worker/dist"), dw, { recursive: true });
gravarJson(join(dw, "package.json"), {
  name: "achadinhos-worker",
  private: true,
  type: "module",
  engines: { node: ">=22.12" },
  scripts: { start: "node worker.mjs" },
});

// ---------- painel ----------
const dp = join(saida, "painel");
const origem = join(raiz, "apps/painel");
mkdirSync(dp, { recursive: true });
for (const item of ["src", "public", "next.config.ts", "postcss.config.mjs", "components.json"]) {
  if (existsSync(join(origem, item))) cpSync(join(origem, item), join(dp, item), { recursive: true });
}
// Testes não vão para o deploy.
execSync(`find ${JSON.stringify(join(dp, "src"))} -name '*.test.ts' -delete`);

const pkgPainel = ler("apps/painel/package.json");
pkgPainel.name = "achadinhos-painel";
pkgPainel.dependencies["@achadinhos/shared"] = "file:./libs/shared";
pkgPainel.devDependencies = Object.fromEntries(
  Object.entries(pkgPainel.devDependencies).filter(([n]) => n !== "vitest"),
);
delete pkgPainel.scripts.test;
pkgPainel.engines = { node: ">=22.12" };
gravarJson(join(dp, "package.json"), pkgPainel);

// tsconfig autônomo (sem o extends do monorepo).
const base = ler("tsconfig.base.json").compilerOptions;
const tsPainel = ler("apps/painel/tsconfig.json");
delete tsPainel.extends;
tsPainel.compilerOptions = { ...base, ...tsPainel.compilerOptions };
gravarJson(join(dp, "tsconfig.json"), tsPainel);

// Pacote compartilhado, como fonte TypeScript (o Next transpila: transpilePackages).
const dv = join(dp, "libs/shared");
mkdirSync(dv, { recursive: true });
cpSync(join(raiz, "packages/shared/src"), join(dv, "src"), { recursive: true });
execSync(`find ${JSON.stringify(join(dv, "src"))} -name '*.test.ts' -delete`);
const pkgShared = ler("packages/shared/package.json");
gravarJson(join(dv, "package.json"), {
  name: pkgShared.name,
  version: pkgShared.version,
  private: true,
  type: "module",
  exports: pkgShared.exports,
  dependencies: pkgShared.dependencies,
});
writeFileSync(join(dp, ".npmrc"), "fund=false\naudit=false\n");
// Lockfile: o npm da Vertra instala sem resolver a árvore (menos memória, versões fixas).
execSync("npm install --package-lock-only --ignore-scripts --no-fund --no-audit", {
  cwd: dp,
  stdio: "inherit",
});

console.log(`\nPronto:\n  ${dw}\n  ${dp}`);
