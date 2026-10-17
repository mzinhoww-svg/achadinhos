#!/usr/bin/env node
/**
 * Sonda real da credencial Shopee (checklist MVP, itens 2 e 10).
 *
 * Faz **uma** consulta somente-leitura — `productOfferV2` com `limit: 1`, o
 * mesmo alvo de `validateShopee` (apps/worker/src/validation/validators.ts) —
 * contra o endpoint real e imprime só três linhas: resultado, código do erro e
 * contagem de ofertas. Nunca em laço.
 *
 * Nunca imprime App ID, Secret, header de assinatura nem corpo de resposta;
 * `.env` da raiz é lido sem sobrescrever o que já veio do shell.
 *
 * Uso: pnpm shopee:live-check   (exit 0 = credencial aceita; 1 = recusada/falha)
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { ShopeeError, createShopeeClient } from "../packages/shopee/src/index.js";
import {
  type LiveCheckResult,
  formatLiveCheck,
  liveCheckErrorCode,
  runOfferLiveCheck,
} from "../packages/shopee/src/live-check.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ENV_FILE = join(ROOT, ".env");

const failure = (codigo: string): LiveCheckResult => ({
  resultado: "falha",
  codigo,
  contagem: 0,
});

function loadEnvFile(): void {
  if (!existsSync(ENV_FILE)) return;
  // Como `--env-file`: não sobrescreve variável já definida no ambiente.
  process.loadEnvFile(ENV_FILE);
}

async function main(): Promise<LiveCheckResult> {
  loadEnvFile();

  const appId = (process.env.SHOPEE_APP_ID ?? "").trim();
  const secret = (process.env.SHOPEE_SECRET ?? "").trim();
  const endpoint = (process.env.SHOPEE_ENDPOINT ?? "").trim();

  if (!appId || !secret) return failure("CREDENCIAL_AUSENTE");

  let client;
  try {
    client = createShopeeClient({ appId, secret }, endpoint ? { endpoint } : {});
  } catch (error) {
    return failure(error instanceof ShopeeError ? liveCheckErrorCode(error) : "ERRO_DESCONHECIDO");
  }

  return runOfferLiveCheck(client);
}

main().then(
  (result) => {
    process.stdout.write(`${formatLiveCheck(result)}\n`);
    process.exitCode = result.resultado === "sucesso" ? 0 : 1;
  },
  () => {
    process.stdout.write(`${formatLiveCheck(failure("ERRO_DESCONHECIDO"))}\n`);
    process.exitCode = 1;
  },
);
