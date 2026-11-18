#!/usr/bin/env node
// Makes the gateway credentials on YOUR computer. Nothing is sent anywhere.
//
//   node tools/make-credentials.mjs admin@example.com
//
// It asks for the admin password without echo (or reads it from standard input), then prints:
//   * the 3 values to set as variables of the Vertra application (hashes only, no secret);
//   * the API token, shown once: keep it in a password manager and give it only to the chat or
//     tool that must reach the agents. The server keeps only its SHA-256.
import crypto from "node:crypto";
import readline from "node:readline";

const email = (process.argv[2] || "").trim().toLowerCase();
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { console.error("Usage: node tools/make-credentials.mjs <admin email>"); process.exit(2); }

async function askPassword() {
  if (!process.stdin.isTTY) { let s = ""; for await (const c of process.stdin) s += c; return s.replace(/\r?\n$/, ""); }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl._writeToOutput = (s) => { if (s.includes("Senha")) process.stdout.write(s); };
  const q = (t) => new Promise((r) => rl.question(t, r));
  const a = await q("Senha do admin (mín. 14 caracteres): "); process.stdout.write("\n");
  const b = await q("Repita a Senha: "); process.stdout.write("\n");
  rl.close();
  if (a !== b) { console.error("As senhas não conferem."); process.exit(1); }
  return a;
}

const password = await askPassword();
if (password.length < 14) { console.error("Use pelo menos 14 caracteres."); process.exit(1); }
const N = 16384, r = 8, p = 1, salt = crypto.randomBytes(16);
const hash = crypto.scryptSync(password.normalize("NFKC"), salt, 32, { N, r, p, maxmem: 256 * N * r });
const token = "obg_" + crypto.randomBytes(32).toString("base64url");
const tokenSha = crypto.createHash("sha256").update(token).digest("hex");

console.log("\nVariáveis da aplicação na Vertra (não são segredos reversíveis):");
console.log(`OBG_ADMIN_EMAIL=${email}`);
console.log(`OBG_ADMIN_PASSWORD_HASH=scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${hash.toString("base64")}`);
console.log(`OBG_API_TOKEN_SHA256=${tokenSha}`);
console.log("\nToken da API (mostrado uma vez; guarde no gerenciador de senhas):");
console.log(token);
