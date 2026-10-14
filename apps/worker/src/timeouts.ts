export class StepTimeoutError extends Error {
  constructor(readonly step: string) {
    super(`timeout na etapa ${step}`);
    this.name = "StepTimeoutError";
  }
}

/** Corrida contra um timer; o trabalho em curso é abandonado (quem tem AbortController deve abortar por conta própria). */
export function withTimeout<T>(work: Promise<T>, ms: number, step: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new StepTimeoutError(step)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}
