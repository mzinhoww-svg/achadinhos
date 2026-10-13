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

  private async sendCause(cause: AlertInput, context?: AlertContext): Promise<AlertResult> {
    const reason = normalizeCause(cause);
    const now = this.now();
    const recipients = this.toDefault;

    // dedup: um alerta por causa até resolver
    if (this.state.active.has(reason)) {
      return { sent: false, duplicate: true, reason, recipients, cause: reason };
    }
    // debounce por tempo (opcional)
    const last = this.state.lastSentAt.get(reason) ?? 0;
    if (this.cooldownMs > 0 && now - last < this.cooldownMs) {
      return { sent: false, duplicate: true, reason, recipients, cause: reason };
    }

    const sanitizedContext = sanitizeContext(context as Record<string, unknown>);
    const message = this.buildMessage(reason, sanitizedContext, recipients);

    await this.dispatch(message);

    this.state.active.add(reason);
    this.state.lastSentAt.set(reason, now);
    this.state.history.push({ cause: reason, at: now, message, context: sanitizedContext });

    return { sent: true, duplicate: false, reason, recipients, cause: reason };
  }

  private buildMessage(reason: string, context: Record<string, unknown>, recipients: string | string[]): EmailMessage {
    const subject = `${this.subjectPrefix} ${subjectFor(reason)}`;
    const lines: string[] = [];
    lines.push(subjectLine(reason));
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
    this.state.active.delete(String(cause));
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
    return this.state.active.has(String(cause));
  }

  isActive(cause: string): boolean {
    return this.state.active.has(String(cause));
  }

  hasActive(): boolean {
    return this.state.active.size > 0;
  }

  getActiveCauses(): string[] {
    return [...this.state.active];
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
    const nowMs = now !== undefined ? toMillis(now) : this.now();
    const lastMs = toMillis(lastHeartbeatAt);
    if (nowMs - lastMs > this.heartbeatThresholdMs) {
      return this.sendCause(ALERT_CAUSE_WORKER_NO_HEARTBEAT, {
        lastHeartbeatAt: new Date(lastMs).toISOString(),
        ageMs: nowMs - lastMs,
      });
    }
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

function subjectFor(reason: string): string {
  if (reason === ALERT_CAUSE_SHOPEE_CREDENTIAL_FAILED) return "credencial Shopee falhou";
  if (reason === ALERT_CAUSE_TELEGRAM_BOT_LOST_ACCESS) return "bot perdeu acesso a grupo";
  if (reason === ALERT_CAUSE_WORKER_NO_HEARTBEAT) return "worker sem heartbeat (>10 min)";
  return reason;
}

function subjectLine(reason: string): string {
  if (reason === ALERT_CAUSE_SHOPEE_CREDENTIAL_FAILED) return "A credencial da Shopee falhou na validação.";
  if (reason === ALERT_CAUSE_TELEGRAM_BOT_LOST_ACCESS) return "O bot perdeu acesso a um grupo do Telegram.";
  if (reason === ALERT_CAUSE_WORKER_NO_HEARTBEAT) return "O worker está sem heartbeat por mais de 10 minutos.";
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