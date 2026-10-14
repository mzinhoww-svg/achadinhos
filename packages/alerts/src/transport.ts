import type { AlertServiceOptions, EmailMessage, EmailSendResult, HttpEmailTransportOptions } from "./types";
import { EmailTimeoutError, EmailTransportError, redactSecrets, safeErrorMessage } from "./errors";

export type { EmailMessage, EmailSendResult, HttpEmailTransportOptions, AlertServiceOptions };
export type { EmailTransport } from "./types";
import type { EmailTransport } from "./types";

export class InMemoryEmailTransport implements EmailTransport {
  readonly emails: EmailMessage[] = [];
  readonly sent: EmailMessage[] = [];
  readonly messages: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const copy: EmailMessage = { ...message, to: normalizeTo(message.to) };
    this.emails.push(copy);
    this.sent.push(copy);
    this.messages.push(copy);
    return { accepted: true, id: `mem-${this.emails.length}`, messageId: `mem-${this.emails.length}`, to: copy.to, subject: copy.subject };
  }

  async sendEmail(message: EmailMessage): Promise<EmailSendResult> {
    return this.send(message);
  }

  async deliver(message: EmailMessage): Promise<EmailSendResult> {
    return this.send(message);
  }

  getSentEmails(): EmailMessage[] {
    return [...this.emails];
  }

  getSentMessages(): EmailMessage[] {
    return [...this.messages];
  }

  getSent(): EmailMessage[] {
    return [...this.sent];
  }

  count(): number {
    return this.emails.length;
  }

  clear(): void {
    this.emails.length = 0;
    this.sent.length = 0;
    this.messages.length = 0;
  }

  reset(): void {
    this.clear();
  }
}

// Factory aliases
export function createInMemoryEmailTransport(): InMemoryEmailTransport {
  return new InMemoryEmailTransport();
}
export const createMemoryEmailTransport = createInMemoryEmailTransport;
export const createSimulatedEmailTransport = createInMemoryEmailTransport;
export const createMockEmailTransport = createInMemoryEmailTransport;

export interface GenericHttpEmailTransportOptions extends HttpEmailTransportOptions {}

export class HttpEmailTransport implements EmailTransport {
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  private readonly headers: Record<string, string>;
  private readonly from?: string;
  private readonly requests: Array<{ url: string; init: RequestInit }> = [];

  constructor(
    apiKeyOrOptions?: string | GenericHttpEmailTransportOptions,
    options?: GenericHttpEmailTransportOptions,
  ) {
    let opts: GenericHttpEmailTransportOptions;
    if (typeof apiKeyOrOptions === "string") {
      opts = { ...(typeof options === "function" ? { fetch: options as unknown as typeof fetch } : (options ?? {})), apiKey: apiKeyOrOptions };
    } else if (typeof apiKeyOrOptions === "function") {
      opts = { fetch: apiKeyOrOptions as unknown as typeof fetch, ...(typeof options === "object" && options ? options : {}) };
    } else {
      opts = (apiKeyOrOptions ?? {}) as GenericHttpEmailTransportOptions;
    }
    const resolved =
      opts.apiKey ??
      opts.token ??
      opts.key ??
      opts.secret ??
      opts.password ??
      readEnvKey();
    if (!resolved) throw new EmailTransportError("Email provider API key is required");
    this.apiKey = resolved;
    this.endpoint =
      opts.endpoint ??
      opts.url ??
      opts.baseUrl ??
      readEnvEndpoint() ??
      "https://email-provider.invalid/send";
    this.fetchFn = opts.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
    this.timeoutMs = opts.timeoutMs ?? opts.timeout ?? 10000;
    this.from = opts.from;
    this.headers = { ...(opts.headers ?? {}) };
  }

  get url(): string {
    return this.endpoint;
  }

  get baseUrl(): string {
    return this.endpoint;
  }

  get timeout(): number {
    return this.timeoutMs;
  }

  getRequests(): Array<{ url: string; init: RequestInit }> {
    return [...this.requests];
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const controller = new AbortController();
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new EmailTimeoutError(redactSecrets("Timeout while sending email")));
      }, this.timeoutMs);
    });

    const body = JSON.stringify({
      from: message.from ?? this.from,
      to: normalizeTo(message.to),
      cc: message.cc,
      bcc: message.bcc,
      replyTo: message.replyTo,
      subject: message.subject,
      text: message.text,
      html: message.html,
      headers: message.headers,
    });

    const headers: Record<string, string> = {
      "content-type": "application/json",
      authorization: `Bearer ${this.apiKey}`,
      "x-api-key": this.apiKey,
      ...this.headers,
    };

    try {
      const fetchPromise = this.fetchFn(this.endpoint, {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
      });

      const response = await Promise.race([fetchPromise, timeoutPromise]);

      let text = "";
      try {
        text = await Promise.race([response.text(), timeoutPromise]);
      } catch (cause) {
        if (timer) clearTimeout(timer);
        if (timedOut || isAbortError(cause)) {
          throw new EmailTimeoutError(redactSecrets("Timeout while sending email"));
        }
        throw new EmailTransportError(redactSecrets(`Network error while sending email: ${safeErrorMessage(cause as unknown, [this.apiKey])}`, [this.apiKey]), {
          cause,
        });
      }

      if (timer) clearTimeout(timer);

      if (!response.ok) {
        throw new EmailTransportError(
          redactSecrets(`Email provider HTTP ${response.status}: ${text.slice(0, 200)}`),
        );
      }

      let data: unknown;
      try {
        data = text.trim() === "" ? {} : JSON.parse(text);
      } catch {
        throw new EmailTransportError(redactSecrets(`Invalid email provider response: ${text.slice(0, 200)}`));
      }

      if (data && typeof data === "object") {
        const obj = data as Record<string, unknown>;
        if ("error" in obj || "errors" in obj || obj.ok === false || obj.success === false || obj.accepted === false) {
          throw new EmailTransportError(redactSecrets(`Email provider rejected request: ${text.slice(0, 200)}`));
        }
      }

      const id = extractId(data);
      const accepted =
        id !== undefined ||
        (data !== null && typeof data === "object" && (
          (data as Record<string, unknown>).accepted === true ||
          (data as Record<string, unknown>).ok === true ||
          (data as Record<string, unknown>).success === true
        ));
      if (!accepted) {
        throw new EmailTransportError(redactSecrets(`Invalid email provider response: ${text.slice(0, 200)}`));
      }

      return { accepted: true, id, messageId: id, to: message.to, subject: message.subject };
    } catch (cause) {
      clearTimeout(timer);
      if (cause instanceof EmailTimeoutError || timedOut || isAbortError(cause)) {
        throw new EmailTimeoutError(redactSecrets("Timeout while sending email"));
      }
      if (cause instanceof EmailTransportError) throw cause;
      throw new EmailTransportError(redactSecrets(`Network error while sending email: ${safeErrorMessage(cause as unknown, [this.apiKey])}`), {
        cause,
      });
    }
  }

  async sendEmail(message: EmailMessage): Promise<EmailSendResult> {
    return this.send(message);
  }

  async deliver(message: EmailMessage): Promise<EmailSendResult> {
    return this.send(message);
  }
}

// Aliases
export const GenericHttpEmailTransport = HttpEmailTransport;
export const GenericEmailTransport = HttpEmailTransport;
export const FetchEmailTransport = HttpEmailTransport;
export const HttpTransport = HttpEmailTransport;
export const EmailHttpTransport = HttpEmailTransport;

export function createHttpEmailTransport(
  apiKeyOrOptions?: string | GenericHttpEmailTransportOptions,
  options?: GenericHttpEmailTransportOptions,
): HttpEmailTransport {
  return new HttpEmailTransport(apiKeyOrOptions, options);
}
export const createGenericHttpEmailTransport = createHttpEmailTransport;
export const createEmailHttpTransport = createHttpEmailTransport;
export const createFetchEmailTransport = createHttpEmailTransport;

function readEnvKey(): string | undefined {
  if (typeof process === "undefined" || !process.env) return undefined;
  return (
    process.env.EMAIL_PROVIDER_API_KEY ||
    process.env.EMAIL_API_KEY ||
    process.env.ALERTS_EMAIL_API_KEY ||
    process.env.EMAIL_SECRET
  );
}

function readEnvEndpoint(): string | undefined {
  if (typeof process === "undefined" || !process.env) return undefined;
  return process.env.EMAIL_PROVIDER_ENDPOINT || process.env.EMAIL_ENDPOINT || process.env.ALERTS_EMAIL_ENDPOINT;
}

function normalizeTo(to: EmailMessage["to"]): string | string[] {
  return Array.isArray(to) ? [...to] : to;
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof Error && (cause.name === "AbortError" || /aborted/i.test(cause.message));
}

function extractId(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const obj = data as Record<string, unknown>;
  for (const k of ["id", "messageId", "message_id", "requestId"]) {
    const v = obj[k];
    if (typeof v === "string" || typeof v === "number") return String(v);
  }
  return undefined;
}