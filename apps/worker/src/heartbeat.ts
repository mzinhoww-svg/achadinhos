export interface HeartbeatStatus {
  healthy: boolean;
  lastBeatAt: number | null;
  sinceLastBeatMs: number | null;
  consecutiveFailures: number;
}

export interface Heartbeat {
  beat(): void;
  status(): HeartbeatStatus;
  /** Executa o tick; só marca batimento se terminar sem erro. */
  runTick(fn: () => Promise<void>): Promise<void>;
}

export function createHeartbeat(opts: { now: () => number; staleAfterMs: number }): Heartbeat {
  let last: number | null = null;
  let failures = 0;

  const beat = () => {
    last = opts.now();
    failures = 0;
  };

  return {
    beat,
    status() {
      const since = last === null ? null : opts.now() - last;
      return {
        healthy: since !== null && since <= opts.staleAfterMs,
        lastBeatAt: last,
        sinceLastBeatMs: since,
        consecutiveFailures: failures,
      };
    },
    async runTick(fn) {
      try {
        await fn();
      } catch (e) {
        failures += 1;
        throw e;
      }
      beat();
    },
  };
}
