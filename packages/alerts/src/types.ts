// Tipos do pacote de alertas por e-mail.

export const ALERT_CAUSE_SHOPEE_CREDENTIAL_FAILED = "shopee_credential_failed" as const;
export const ALERT_CAUSE_TELEGRAM_BOT_LOST_ACCESS = "telegram_bot_lost_access" as const;
export const ALERT_CAUSE_WORKER_NO_HEARTBEAT = "worker_no_heartbeat" as const;

export const AlertCauses = {
  ShopeeCredentialFailed: ALERT_CAUSE_SHOPEE_CREDENTIAL_FAILED,
  TelegramBotLostAccess: ALERT_CAUSE_TELEGRAM_BOT_LOST_ACCESS,
  WorkerNoHeartbeat: ALERT_CAUSE_WORKER_NO_HEARTBEAT,
} as const;

export type AlertCause =
  | typeof ALERT_CAUSE_SHOPEE_CREDENTIAL_FAILED
  | typeof ALERT_CAUSE_TELEGRAM_BOT_LOST_ACCESS
  | typeof ALERT_CAUSE_WORKER_NO_HEARTBEAT
  | (string & {});

export type AlertSeverity = "info" | "warning" | "critical";

export interface AlertContext {
  [key: string]: unknown;
  reason?: string;
  error?: unknown;
  group?: string | number;
  accountId?: string | number;
  lastHeartbeatAt?: number | Date | string;
  details?: Record<string, unknown>;
}

export type EmailAddress = string;

export interface EmailMessage {
  to: string | string[];
  from?: string;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string | string[];
  subject: string;
  text?: string;
  html?: string;
  headers?: Record<string, string>;
}

export interface EmailSendResult {
  accepted: boolean;
  id?: string;
  messageId?: string;
  to?: string | string[];
  subject?: string;
}

export interface HttpEmailTransportOptions {
  apiKey?: string;
  token?: string;
  key?: string;
  secret?: string;
  password?: string;
  endpoint?: string;
  baseUrl?: string;
  url?: string;
  fetch?: typeof fetch;
  timeout?: number;
  timeoutMs?: number;
  headers?: Record<string, string>;
  from?: string;
  defaultTo?: string;
  to?: string | string[];
}

export interface AlertServiceOptions {
  transport?: EmailTransportLike;
  emailTransport?: EmailTransportLike;
  now?: () => number | Date;
  clock?: () => number | Date;
  to?: string | string[];
  recipient?: string | string[];
  defaultTo?: string | string[];
  from?: string;
  sender?: string;
  subjectPrefix?: string;
  cooldownMs?: number;
  debounceMs?: number;
  heartbeatThresholdMs?: number;
  maxHeartbeatAgeMs?: number;
}

export interface EmailTransport {
  send(message: EmailMessage): Promise<EmailSendResult | void> | EmailSendResult | void;
  sendEmail?(message: EmailMessage): Promise<EmailSendResult | void> | EmailSendResult | void;
  deliver?(message: EmailMessage): Promise<EmailSendResult | void> | EmailSendResult | void;
}

// Minimal structural type accepted by the service; concrete transports implement EmailTransport.
export interface EmailTransportLike extends EmailTransport {}

export interface Transport extends EmailTransportLike {}

export const DEFAULT_ALERT_EMAIL_TO = (typeof process !== "undefined" && process.env?.ALERT_EMAIL_TO) || "mazinhoww@gmail.com";

export function defaultAlertRecipient(): string {
  return (typeof process !== "undefined" && process.env?.ALERT_EMAIL_TO) || "mazinhoww@gmail.com";
}