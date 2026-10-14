import { describe, it } from "vitest";

/**
 * Mesmo roteiro do pipeline.test.ts contra Postgres real (fila SQL do #15). Marcado: falta o
 * adaptador SQL do worker (SchedulerStore/claim por `pg`), então só roda com TEST_DATABASE_URL e
 * hoje apenas registra o gap. A semântica do claim já é exercitada em supabase/tests/
 * (pgTAP + concurrency/claim_next_send.sh).
 */
describe.skipIf(!process.env.TEST_DATABASE_URL)("e2e contra Postgres real", () => {
  it.todo("automação -> oferta -> link curto -> criativo -> sendPhoto -> sent");
  it.todo("reexecução 2x sem envio duplo (unique parcial + idempotency_key)");
  it.todo("60 s, teto 200 e virada de dia em America/Cuiaba com now() do banco");
});
