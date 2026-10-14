import {
  ALERT_CAUSE_SHOPEE_CREDENTIAL_FAILED,
  ALERT_CAUSE_TELEGRAM_BOT_LOST_ACCESS,
  ALERT_CAUSE_WORKER_NO_HEARTBEAT,
  defaultAlertRecipient,
} from "./types.js";
import type { AlertServiceOptions, AlertContext, EmailMessage, EmailTransport, AlertCause } from "./types.js";
import { EmailTransportError, sanitizeContext } from "./errors.js";
import { InMemoryEmailTransport } from "./transport.js";

export type AlertInput = string | { reason?: string; cause?: string; type?: string; code?: string; name?: string };

export type AlertResult = {
  sent: boolean;
  duplicate: boolean;
  reason: string;
  recipients: string | string[];
  cause: AlertCause | string;
};

interface InternalAlertState {
  active: Set<string>;
  lastSentAt: Map<string, number>;
  history: Array<{ cause: string; at: number; message: EmailMessage; context: Record<string, unknown> }>;
}

export class AlertService {
  private readonly inflight = new Map<string, Promise<AlertResult>>();
  private readonly transport: EmailTransport;
  private readonly now: () => number;
  private readonly toDefault: string | string[];
  private readonly from?: string;
  private readonly subjectPrefix: string;
  private readonly cooldownMs: number;
  private readonly heartbeatThresholdMs: number;
  private readonly state: InternalAlertState = {
    active: new Set(),
    lastSentAt: new Map(),
    history: [],
  };

  constructor(...args: unknown[]) {
    let opts: AlertServiceOptions = {};
    let transport: EmailTransport | undefined;

    // Parse flexible args.
    for (const arg of args) {
      if (typeof arg === "function") {
        opts = { ...opts, now: arg as () => number | Date };
        continue;
      }
      if (isTransport(arg)) {
        transport = arg as EmailTransport;
        continue;
      }
      if (arg && typeof arg === "object") {
        const o = arg as Record<string, unknown>;
        if (isTransport(o.transport) || isTransport(o.emailTransport)) {
          if (isTransport(o.transport)) transport = o.transport as EmailTransport;
          else if (isTransport(o.emailTransport)) transport = o.emailTransport as EmailTransport;
        }
        opts = { ...opts, ...(o as AlertServiceOptions) };
        if (!transport && isTransport(o)) transport = o as unknown as EmailTransport;
      }
    }

    const resolvedTransport =
      transport ??
      (opts.transport as EmailTransport | undefined) ??
      (opts.emailTransport as EmailTransport | undefined) ??
      new InMemoryEmailTransport();

    if (!resolvedTransport) throw new EmailTransportError("Email transport is required");
    this.transport = resolvedTransport;

    const clockOpt = opts.now ?? opts.clock;
    const userClock = typeof clockOpt === "function" ? (clockOpt as () => number | Date) : undefined;
    this.now = () => toMillis(userClock ? userClock() : Date.now());

    const recipient =
      opts.to ?? opts.recipient ?? opts.defaultTo ?? readEnvRecipient();
    this.toDefault = (recipient ?? defaultAlertRecipient()) as string | string[];
    this.from = opts.sender ?? opts.from;
    this.subjectPrefix = opts.subjectPrefix ?? "[achadinhos]";
    this.cooldownMs = opts.cooldownMs ?? opts.debounceMs ?? 0;
    this.heartbeatThresholdMs = opts.heartbeatThresholdMs ?? opts.maxHeartbeatAgeMs ?? 10 * 60 * 1000;
  }

  // ---------- Core ----------
  async alert(cause: AlertInput, context?: AlertContext): Promise<AlertResult> {
    return this.raise(cause, context);
  }

  async raise(cause: AlertInput, context?: AlertContext): Promise<AlertResult> {
    return this.sendCause(cause, context);
  }

  async notify(cause: AlertInput, context?: AlertContext): Promise<AlertResult> {
    return this.sendCause(cause, context);
  }

  async trigger(cause: AlertInput, context?: AlertContext): Promise<AlertResult> {
    return this.sendCause(cause, context);
  }

  async sendAlert(cause: AlertInput, context?: AlertContext): Promise<AlertResult> {
    return this.sendCause(cause, context);
  }
  async emit(cause: AlertInput, context?: AlertContext): Promise<AlertResult> {
    return this.sendCause(cause, context);
  }
  async fire(cause: AlertInput, context?: AlertContext): Promise<AlertResult> {
    return this.sendCause(cause, context);
  }
  async publish(cause: AlertInput, context?: AlertContext): Promise<AlertResult> {
    return this.sendCause(cause, context);
  }
  async report(cause: AlertInput, context?: AlertContext): Promise<AlertResult> {
    return this.sendCause(cause, context);
  }

  private async sendCauseLocked(cause: AlertInput, context?: AlertContext): Promise<AlertResult> {
    const reason = normalizeCause(cause);
    const key = alertDedupeKey(reason, context);
    const now = this.now();
    const recipients = this.toDefault;

    // dedup: um alerta por causa (com escopo) até resolver
    if (this.state.active.has(key)) {
      return { sent: false, duplicate: true, reason, recipients, cause: reason };
    }
    // debounce por tempo (opcional)
    const last = this.state.lastSentAt.get(key) ?? 0;
    if (this.cooldownMs > 0 && now - last < this.cooldownMs) {
      return { sent: false, duplicate: true, reason, recipients, cause: reason };
    }

    const sanitizedContext = sanitizeContext(context as Record<string, unknown>);
    const message = this.buildMessage(reason, sanitizedContext, recipients);

    // marca ativo antes do envio para bloquear disparos concorrentes
    this.state.active.add(key);
    try {
      await this.dispatch(message);
    } catch (err) {
      this.state.active.delete(key);
      throw err;
    }

    this.state.lastSentAt.set(key, now);
    this.state.history.push({ cause: reason, at: now, message, context: sanitizedContext });

    return { sent: true, duplicate: false, reason, recipients, cause: reason };
  }

  private async sendCause(cause: AlertInput, context?: AlertContext): Promise<AlertResult> {
    const reason = normalizeCause(cause);
    const key = alertDedupeKey(reason, context);
    const existing = this.inflight.get(key);
    if (existing) return existing;
    const promise = this.sendCauseLocked(cause, context).finally(() => {
      this.inflight.delete(key);
    });
    this.inflight.set(key, promise);
    return promise;
  }


  private buildMessage(reason: string, context: Record<string, unknown>, recipients: string | string[]): EmailMessage {
    const subject = `${this.subjectPrefix} ${subjectFor(reason, this.heartbeatThresholdMs)}`;
    const lines: string[] = [];
    lines.push(subjectLine(reason, this.heartbeatThresholdMs));
    if (Object.keys(context).length > 0) {
      lines.push("");
      lines.push("Contexto (sanitizado):");
      for (const [k, v] of Object.entries(context)) {
        lines.push(`- ${k}: ${formatValue(v)}`);
      }
    }
    lines.push("");
    lines.push("Mensagem automática do achadinhos. Segredos não são incluídos.");
    const text = lines.join("\n");

    return {
      to: recipients,
      from: this.from,
      subject,
      text,
    };
  }

  private async dispatch(message: EmailMessage): Promise<void> {
    const t = this.transport as unknown as { send?: unknown; sendEmail?: unknown; deliver?: unknown };
    if (typeof t.send === "function") {
      await (t.send as (m: EmailMessage) => unknown)(message);
      return;
    }
    if (typeof t.sendEmail === "function") {
      await (t.sendEmail as (m: EmailMessage) => unknown)(message);
      return;
    }
    if (typeof t.deliver === "function") {
      await (t.deliver as (m: EmailMessage) => unknown)(message);
      return;
    }
    throw new EmailTransportError("Transport does not implement send");
  }

  // ---------- Resolução / dedup ----------
  resolve(cause?: string): void {
    this.ack(cause);
  }

  ack(cause?: string): void {
    if (!cause) {
      this.state.active.clear();
      return;
    }
    const wanted = String(cause);
    for (const key of [...this.state.active]) {
      if (baseCause(key) === wanted) this.state.active.delete(key);
    }
  }

  clear(cause?: string): void {
    this.ack(cause);
  }

  reset(cause?: string): void {
    if (!cause) {
      this.state.active.clear();
      this.state.lastSentAt.clear();
      this.state.history.length = 0;
      return;
    }
    this.state.active.delete(String(cause));
    this.state.lastSentAt.delete(String(cause));
  }

  isDuplicate(cause: string): boolean {
    return this.isAlertActive(cause);
  }

  isAlertActive(cause: string): boolean {
    return [...this.state.active].some((k) => baseCause(k) === String(cause));
  }

  isActive(cause: string): boolean {
    return this.isAlertActive(cause);
  }

  hasActive(): boolean {
    return this.state.active.size > 0;
  }

  getActiveCauses(): string[] {
    return [...new Set([...this.state.active].map(baseCause))];
  }

  listActive(): string[] {
    return this.getActiveCauses();
  }

  getHistory(): Array<{ cause: string; at: number; message: EmailMessage; context: Record<string, unknown> }> {
    return [...this.state.history];
  }

  get active(): Set<string> {
    return this.state.active;
  }

  get sent(): EmailMessage[] {
    return this.state.history.map((h) => h.message);
  }
  get emails(): EmailMessage[] {
    return this.sent;
  }

  // ---------- Heartbeat ----------
  checkHeartbeat(lastHeartbeatAt: number | Date, now?: number | Date): Promise<AlertResult> | AlertResult {
    const nowMs = (now !== undefined && Number.isFinite(toMillis(now))) ? toMillis(now) : this.now();
    const lastMs = toMillis(lastHeartbeatAt);
    const stale = !Number.isFinite(lastMs) || nowMs - lastMs > this.heartbeatThresholdMs;
    if (stale) {
      return this.sendCause(ALERT_CAUSE_WORKER_NO_HEARTBEAT, {
        lastHeartbeatAt: Number.isFinite(lastMs) ? new Date(lastMs).toISOString() : undefined,
        ageMs: Number.isFinite(lastMs) ? nowMs - lastMs : undefined,
      });
    }
    // recuperação: heartbeat saudável limpa a causa ativa
    this.ack(ALERT_CAUSE_WORKER_NO_HEARTBEAT);
    return Promise.resolve({ sent: false, duplicate: false, reason: ALERT_CAUSE_WORKER_NO_HEARTBEAT, recipients: this.toDefault, cause: ALERT_CAUSE_WORKER_NO_HEARTBEAT });
  }

  // Alias sync returning promise
  ensureHeartbeat(lastHeartbeatAt: number | Date, now?: number | Date): Promise<AlertResult> {
    const r = this.checkHeartbeat(lastHeartbeatAt, now);
    return r instanceof Promise ? r : Promise.resolve(r);
  }

  workerNoHeartbeat(lastHeartbeatAt?: number | Date): Promise<AlertResult> {
    return this.sendCause(ALERT_CAUSE_WORKER_NO_HEARTBEAT, {
      lastHeartbeatAt: lastHeartbeatAt !== undefined ? new Date(toMillis(lastHeartbeatAt)).toISOString() : undefined,
    });
  }

  // ---------- Cause-specific convenience ----------
  shopeeCredentialFailed(context?: AlertContext): Promise<AlertResult> {
    return this.sendCause(ALERT_CAUSE_SHOPEE_CREDENTIAL_FAILED, context);
  }

  telegramBotLostAccess(context?: AlertContext): Promise<AlertResult> {
    return this.sendCause(ALERT_CAUSE_TELEGRAM_BOT_LOST_ACCESS, context);
  }

  // Allow overriding recipient per instance helper
  get transportInstance(): EmailTransport {
    return this.transport;
  }
}

// ---------- helpers ----------
function isTransport(v: unknown): boolean {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.send === "function" || typeof o.sendEmail === "function" || typeof o.deliver === "function";
}

function toMillis(v: number | Date): number {
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v;
  return Date.parse(String(v));
}

function readEnvRecipient(): string | string[] | undefined {
  if (typeof process === "undefined" || !process.env) return undefined;
  const v = process.env.ALERT_EMAIL_TO;
  return v || undefined;
}

function minutesLabel(ms: number): string {
  const m = ms / 60_000;
  return `${Number.isInteger(m) ? m : m.toFixed(1)} min`;
}

function subjectFor(reason: string, heartbeatThresholdMs: number): string {
  if (reason === ALERT_CAUSE_SHOPEE_CREDENTIAL_FAILED) return "credencial Shopee falhou";
  if (reason === ALERT_CAUSE_TELEGRAM_BOT_LOST_ACCESS) return "bot perdeu acesso a grupo";
  if (reason === ALERT_CAUSE_WORKER_NO_HEARTBEAT) return `worker sem heartbeat (>${minutesLabel(heartbeatThresholdMs)})`;
  return reason;
}

function subjectLine(reason: string, heartbeatThresholdMs: number): string {
  if (reason === ALERT_CAUSE_SHOPEE_CREDENTIAL_FAILED) return "A credencial da Shopee falhou na validação.";
  if (reason === ALERT_CAUSE_TELEGRAM_BOT_LOST_ACCESS) return "O bot perdeu acesso a um grupo do Telegram.";
  if (reason === ALERT_CAUSE_WORKER_NO_HEARTBEAT) return `O worker está sem heartbeat por mais de ${minutesLabel(heartbeatThresholdMs)}.`;
  return `Alerta: ${reason}`;
}

function formatValue(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

// Exports de compatibilidade
export { AlertService as Alerts };
export { AlertService as AlertManager };
export { AlertService as EmailAlertService };
export { AlertService as AlertDispatcher };
export { AlertService as AlertClient };

function alertDedupeKey(reason: string, context?: AlertContext): string {
  const scopeFields = [
    "accountId", "account_id", "group", "groupId", "group_id",
    "channel", "channelId", "channel_id", "to", "recipient", "target",
  ];
  const scope: Record<string, unknown> = {};
  if (context && typeof context === "object") {
    for (const field of scopeFields) {
      const value = (context as Record<string, unknown>)[field];
      if (value !== undefined && value !== null) scope[field] = value;
    }
  }
  const scopeStr = Object.keys(scope).length
    ? JSON.stringify(Object.keys(scope).sort().reduce((acc, k) => {
        acc[k] = scope[k];
        return acc;
      }, {} as Record<string, unknown>))
    : "";
  return scopeStr ? `${reason}::${scopeStr}` : reason;
}

function baseCause(key: string): string {
  const idx = key.indexOf("::");
  return idx === -1 ? key : key.slice(0, idx);
}

function normalizeCause(cause: AlertInput): string {
  if (typeof cause === "string") return cause || "alert";
  if (cause && typeof cause === "object") {
    const c = cause as { reason?: unknown; cause?: unknown; type?: unknown; code?: unknown; name?: unknown };
    const v = c.reason ?? c.cause ?? c.type ?? c.code ?? c.name;
    if (typeof v === "string" && v.length > 0) return v;
  }
  return "alert";
}

export function createAlertService(...args: unknown[]): AlertService {
  return new AlertService(...args);
}
export const createAlerts = createAlertService;
export const createAlertManager = createAlertService;
export const createEmailAlertService = createAlertService;
export const createAlertDispatcher = createAlertService;