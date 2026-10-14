import type { AlertService } from "@achadinhos/alerts";
import type { HeartbeatStore } from "./heartbeat-store.js";

export interface HeartbeatCheck {
  healthy: boolean;
  /** Idade do último batimento; null = nunca houve. */
  ageMs: number | null;
  /** true só quando este check enviou o e-mail (sem repetir enquanto durar). */
  alerted: boolean;
}

export interface HeartbeatMonitor {
  check(): Promise<HeartbeatCheck>;
}

/**
 * Lê a idade do heartbeat no banco e aciona `packages/alerts`. Erro de leitura ou de
 * envio propaga: não equivale a "worker morto" nem engole o alerta (o próximo check
 * tenta de novo, porque o AlertService só marca a causa ativa após enviar).
 */
export function createHeartbeatMonitor(opts: {
  store: HeartbeatStore;
  alerts: AlertService;
  staleAfterMs: number;
  now?: () => number;
}): HeartbeatMonitor {
  const now = opts.now ?? Date.now;
  return {
    async check() {
      const ageMs = await opts.store.ageMs();
      const t = now();
      // Nunca houve batimento: tratado como parado desde sempre (falha fechada).
      const last = ageMs === null ? Number.NaN : t - ageMs;
      const healthy = ageMs !== null && ageMs <= opts.staleAfterMs;
      const r = await opts.alerts.checkHeartbeat(last, t);
      return { healthy, ageMs, alerted: r.sent };
    },
  };
}
