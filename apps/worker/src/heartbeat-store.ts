import type { Heartbeat } from "./heartbeat.js";

/** Heartbeat persistido (decisão 003, H5): o worker grava, o monitor lê a idade. */
export interface HeartbeatStore {
  record(workerId: string): Promise<void>;
  /** Idade (ms) do batimento mais recente entre todos os workers; null = nunca houve. */
  ageMs(): Promise<number | null>;
}

/** Em memória (testes e dev). `now` faz o papel do relógio do banco. */
export class MemoryHeartbeatStore implements HeartbeatStore {
  readonly #beats = new Map<string, number>();
  constructor(private readonly now: () => number) {}

  async record(workerId: string): Promise<void> {
    if (workerId.length < 1 || workerId.length > 100) throw new Error("worker_id inválido");
    this.#beats.set(workerId, this.now());
  }

  async ageMs(): Promise<number | null> {
    if (this.#beats.size === 0) return null;
    return Math.max(0, this.now() - Math.max(...this.#beats.values()));
  }
}

/** Qualquer driver com `query(sql, params)` (pg, postgres.js via wrapper, PGlite). */
export interface SqlExecutor {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

/** Adaptador SQL: usa as funções da migração 20261015120000 (relógio do banco). */
export class SqlHeartbeatStore implements HeartbeatStore {
  constructor(private readonly db: SqlExecutor) {}

  async record(workerId: string): Promise<void> {
    await this.db.query("SELECT public.record_worker_heartbeat($1)", [workerId]);
  }

  async ageMs(): Promise<number | null> {
    const r = await this.db.query<{ age: string | number | null }>(
      "SELECT public.worker_heartbeat_age_ms() AS age",
    );
    const age = r.rows[0]?.age;
    return age === null || age === undefined ? null : Number(age);
  }
}

export interface HeartbeatPublisher {
  /** Roda o tick; grava batimento persistido só se terminar sem erro. */
  runTick(fn: () => Promise<void>): Promise<void>;
}

/**
 * Compõe o heartbeat em memória (`runTick` já só marca em sucesso) com a gravação
 * persistida. Falha ao gravar não derruba o tick: a ausência de batimento é o que
 * dispara o alerta, e o erro vai para `onError` (já redigido pelo logger).
 */
export function createHeartbeatPublisher(opts: {
  store: HeartbeatStore;
  workerId: string;
  local?: Heartbeat;
  onError: (e: unknown) => void;
}): HeartbeatPublisher {
  return {
    async runTick(fn) {
      const run = opts.local ? () => opts.local!.runTick(fn) : fn;
      await run();
      try {
        await opts.store.record(opts.workerId);
      } catch (e) {
        opts.onError(e);
      }
    },
  };
}
