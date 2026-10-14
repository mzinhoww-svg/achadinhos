import type { SecretVault, ValidationStatus, ValidationStore, ValidationTask } from "./types.js";

/** Doubles em memória, só para testes e para o simulado local. */
export class MemoryVault implements SecretVault {
  constructor(private readonly secrets: Record<string, string>) {}
  async read(secretId: string): Promise<string | null> {
    return this.secrets[secretId] ?? null;
  }
}

type Row = {
  task: ValidationTask;
  status: ValidationStatus;
  lastError: string | null;
  validatedAt: Date | null;
  attempts: number;
  claimed: boolean;
  verificationSentAt: Date | null;
};

export class MemoryValidationStore implements ValidationStore {
  private readonly rows = new Map<string, Row>();

  constructor(tasks: ValidationTask[] = []) {
    for (const t of tasks) this.add(t);
  }

  add(task: ValidationTask): void {
    this.rows.set(task.id, {
      task,
      status: "pending_validation",
      lastError: null,
      validatedAt: null,
      attempts: task.attempts,
      claimed: false,
      verificationSentAt: task.kind === "telegram_group" ? (task.verificationSentAt ?? null) : null,
    });
  }

  result(id: string) {
    const row = this.rows.get(id);
    if (!row) throw new Error(`unknown task ${id}`);
    return {
      status: row.status,
      lastError: row.lastError,
      validatedAt: row.validatedAt,
      attempts: row.attempts,
      verificationSentAt: row.verificationSentAt,
    };
  }

  async claimPending(limit: number): Promise<ValidationTask[]> {
    const out: ValidationTask[] = [];
    for (const row of this.rows.values()) {
      if (out.length >= limit) break;
      if (row.status === "pending_validation" && !row.claimed) {
        row.claimed = true;
        out.push(
          row.task.kind === "telegram_group"
            ? { ...row.task, attempts: row.attempts, verificationSentAt: row.verificationSentAt }
            : { ...row.task, attempts: row.attempts },
        );
      }
    }
    return out;
  }

  async markValidated(task: ValidationTask, at: Date): Promise<void> {
    const row = this.row(task);
    Object.assign(row, { status: "validated", lastError: null, validatedAt: at, claimed: false });
  }

  async markInvalid(
    task: ValidationTask,
    lastError: string,
    _at?: Date,
    options?: { clearVerification?: boolean },
  ): Promise<void> {
    const row = this.row(task);
    if (options?.clearVerification) row.verificationSentAt = null;
    Object.assign(row, { status: "invalid", lastError, claimed: false });
  }

  /** Simula o painel pedindo nova validação (contrato em `ValidationStore.markInvalid`). */
  requeue(id: string): void {
    const row = this.rows.get(id);
    if (!row) throw new Error(`unknown task ${id}`);
    Object.assign(row, {
      status: "pending_validation",
      lastError: null,
      validatedAt: null,
      attempts: 0,
      verificationSentAt: null,
      claimed: false,
    });
  }

  async markVerificationSent(task: ValidationTask, at: Date): Promise<void> {
    this.row(task).verificationSentAt = at;
  }

  async release(
    task: ValidationTask,
    lastError: string,
    _at: Date,
    options?: { clearVerification?: boolean },
  ): Promise<void> {
    const row = this.row(task);
    if (options?.clearVerification) row.verificationSentAt = null;
    row.attempts += 1;
    Object.assign(row, { status: "pending_validation", lastError, claimed: false });
  }

  private row(task: ValidationTask): Row {
    const row = this.rows.get(task.id);
    if (!row) throw new Error(`unknown task ${task.id}`);
    return row;
  }
}
