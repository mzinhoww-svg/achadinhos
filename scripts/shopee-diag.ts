#!/usr/bin/env node
/**
 * T12 — modo de diagnóstico do erro 10010 da Shopee (plano:
 * docs/plans/shopee-diagnostico-10010.md, §3 e §4).
 *
 * Só o degrau **D0** está implementado e autorizado: corpo `{"query":"{ __typename }"}`,
 * uma única requisição, sem laço e sem retry. Qualquer `--degrau` diferente de D0
 * é recusado **antes** de qualquer envio (e o valor recebido não é ecoado).
 *
 * Saída: apenas as oito linhas allowlisted do §4 (`degrau`, `codigo` validado por
 * `^[A-Za-z0-9_-]{1,32}$` ou `CODIGO_INVALIDO`, `contagem`, `duracao_ms`,
 * `mensagem` saneada, `hora_local_utc`, `date_resposta`, `delta_date_s`).
 * Nunca saem App ID, Secret, header de assinatura, corpo da resposta ou outros
 * cabeçalhos; o `Date` da resposta sai normalizado.
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
  MAX_BODY_BYTES,
  buildDiagBody,
  assertAllowedEndpoint,
  diagClock,
  formatDiagReport,
  summarizeDiag,
} from "./diag-allowlist.js";
import type { DiagReport } from "./diag-allowlist.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ENV_FILE = join(ROOT, ".env");
const DEFAULT_ENDPOINT = "https://open-api.affiliate.shopee.com.br/graphql";
const TIMEOUT_MS = 20_000;

function refusal(codigo: string, startedAtMs: number): DiagReport {
  const localMs = Date.now();
  return {
    degrau: DEGRAU_D0,
    codigo,
    contagem: 0,
    duracao_ms: Math.max(0, Math.round(localMs - startedAtMs)),
    mensagem: null,
    ...diagClock(null, localMs),
  };
}

function loadEnvFile(): void {
  if (!existsSync(ENV_FILE)) return;
  // Como `--env-file`: não sobrescreve variável já definida no ambiente.
  process.loadEnvFile(ENV_FILE);
}

function readDegrau(argv: string[]): string | null {
  const index = argv.indexOf("--degrau");
  if (index === -1) return null;
  return argv[index + 1] ?? null;
}

async function main(): Promise<{ report: DiagReport; exit: number }> {
  const startedAtMs = Date.now();

  if (readDegrau(process.argv.slice(2)) !== DEGRAU_D0) {
    // Fail closed: nenhum outro degrau foi autorizado (sem D1–D4).
    return { report: refusal("DEGRAU_NAO_AUTORIZADO", startedAtMs), exit: 2 };
  }

  loadEnvFile();
  const appId = (process.env.SHOPEE_APP_ID ?? "").trim();
  const secret = (process.env.SHOPEE_SECRET ?? "").trim();
  const endpoint = (process.env.SHOPEE_ENDPOINT ?? "").trim() || DEFAULT_ENDPOINT;

  if (!appId || !secret) {
    return { report: refusal("CREDENCIAL_AUSENTE", startedAtMs), exit: 2 };
  }

  let url: URL;
  try {
    url = assertAllowedEndpoint(endpoint);
  } catch {
    // A mensagem do erro não é impressa: poderia carregar a URL.
    return { report: refusal("ENDPOINT_NAO_PERMITIDO", startedAtMs), exit: 2 };
  }

  const body = buildDiagBody(D0_QUERY);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = sign(appId, timestamp, body, secret);

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, TIMEOUT_MS);

  try {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`,
        },
        body,
        signal: controller.signal,
      });
    } catch {
      return {
        report: refusal(timedOut ? "TIMEOUT" : "NETWORK", startedAtMs),
        exit: 1,
      };
    }

    // Momento local logo após os cabeçalhos: é o que se compara com o `Date`.
    const localMs = Date.now();
    const dateHeader = response.headers.get("date");

    let bodyText: string;
    try {
      bodyText = await response.text();
    } catch {
      return { report: refusal(timedOut ? "TIMEOUT" : "NETWORK", startedAtMs), exit: 1 };
    }

    return {
      report: summarizeDiag({
        degrau: DEGRAU_D0,
        status: response.status,
        ok: response.ok,
        bodyText,
        bodyTooLarge: Buffer.byteLength(bodyText) > MAX_BODY_BYTES,
        dateHeader,
        localMs,
        startedAtMs,
        secrets: [appId, secret],
      }),
      exit: 0,
    };
  } finally {
    clearTimeout(timer);
  }
}

main().then(
  ({ report, exit }) => {
    process.stdout.write(`${formatDiagReport(report)}\n`);
    process.exitCode = exit;
  },
  () => {
    // Falha inesperada: só o código fixo, nunca a exceção crua.
    process.stdout.write(`${formatDiagReport(refusal("ERRO_DESCONHECIDO", Date.now()))}\n`);
    process.exitCode = 1;
  },
);
