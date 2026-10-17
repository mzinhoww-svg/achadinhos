#!/usr/bin/env node
/**
 * T12 — modo de diagnóstico do erro 10010 da Shopee (plano:
 * docs/plans/shopee-diagnostico-10010.md, §3 e §4).
 *
 * Só o degrau **D0** está implementado e autorizado: corpo `{"query":"{ __typename }"}`,
 * uma única requisição, sem laço e sem retry. Qualquer `--degrau` ausente,
 * repetido ou diferente de D0 é recusado **antes** de qualquer envio (e o valor
 * recebido não é ecoado).
 *
 * Saída: apenas as oito linhas allowlisted do §4 (`degrau`, `codigo` validado por
 * `^[A-Za-z0-9_-]{1,32}$` ou `CODIGO_INVALIDO`, `contagem`, `duracao_ms`,
 * `mensagem` por modelo fixo, `hora_local_utc`, `date_resposta`, `delta_date_s`).
 * Nunca saem App ID, Secret, header de assinatura, corpo da resposta ou outros
 * cabeçalhos; o `Date` da resposta sai normalizado.
 *
 * As proteções do §4.7 (allowlist de host, `redirect: manual`, timeout, teto de
 * corpo e uma chamada por invocação) vivem em `diag-allowlist.ts`, cada uma com
 * teste. Aqui só ficam ambiente, argumento, assinatura e impressão.
 *
 * Uso: `pnpm shopee:diag --degrau D0`
 * Exit: 0 = resposta resumida; 1 = sem resposta (transporte); 2 = recusa local.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { sign } from "../packages/shopee/src/index.js";
import {
  D0_QUERY,
  DEGRAU_D0,
  assertAllowedEndpoint,
  buildDiagBody,
  diagRun,
  formatDiagReport,
  refusalReport,
} from "./diag-allowlist.js";
import type { DiagReport } from "./diag-allowlist.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ENV_FILE = join(ROOT, ".env");
const DEFAULT_ENDPOINT = "https://open-api.affiliate.shopee.com.br/graphql";

function loadEnvFile(): void {
  if (!existsSync(ENV_FILE)) return;
  // Como `--env-file`: não sobrescreve variável já definida no ambiente.
  process.loadEnvFile(ENV_FILE);
}

/**
 * `--degrau D0`, exatamente uma vez. Ausente, repetido ou diferente de D0 é
 * recusa local (sem envio) e o valor recebido nunca é ecoado.
 */
function readDegrau(argv: string[]): { ok: boolean; codigo: string } {
  const marcadores = argv.filter((arg) => arg === "--degrau");
  if (marcadores.length > 1) return { ok: false, codigo: "ARGUMENTO_REPETIDO" };
  const index = argv.indexOf("--degrau");
  if (index === -1) return { ok: false, codigo: "DEGRAU_NAO_AUTORIZADO" };
  if (argv[index + 1] !== DEGRAU_D0) return { ok: false, codigo: "DEGRAU_NAO_AUTORIZADO" };
  return { ok: true, codigo: DEGRAU_D0 };
}

async function main(): Promise<{ report: DiagReport; exit: number }> {
  const startedAtMs = Date.now();
  const recusa = (codigo: string): { report: DiagReport; exit: number } => ({
    report: refusalReport(codigo, startedAtMs),
    exit: 2,
  });

  const degrau = readDegrau(process.argv.slice(2));
  if (!degrau.ok) {
    // Fail closed: nenhum outro degrau foi autorizado (sem D1–D4).
    return recusa(degrau.codigo);
  }

  loadEnvFile();
  const appId = (process.env.SHOPEE_APP_ID ?? "").trim();
  const secret = (process.env.SHOPEE_SECRET ?? "").trim();
  const endpoint = (process.env.SHOPEE_ENDPOINT ?? "").trim() || DEFAULT_ENDPOINT;

  if (!appId || !secret) return recusa("CREDENCIAL_AUSENTE");

  let url: URL;
  try {
    // Allowlist de host antes de assinar: o header assinado não sai para outro host.
    url = assertAllowedEndpoint(endpoint);
  } catch {
    // A mensagem do erro não é impressa: poderia carregar a URL.
    return recusa("ENDPOINT_NAO_PERMITIDO");
  }

  const body = buildDiagBody(D0_QUERY);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = sign(appId, timestamp, body, secret);

  return diagRun({
    endpoint: url,
    headers: {
      "Content-Type": "application/json",
      Authorization: `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`,
    },
    body,
    secrets: [appId, secret],
    degrau: DEGRAU_D0,
  });
}

main().then(
  ({ report, exit }) => {
    process.stdout.write(`${formatDiagReport(report)}\n`);
    process.exitCode = exit;
  },
  () => {
    // Falha inesperada: só o código fixo, nunca a exceção crua.
    process.stdout.write(`${formatDiagReport(refusalReport("ERRO_DESCONHECIDO", Date.now()))}\n`);
    process.exitCode = 1;
  },
);
