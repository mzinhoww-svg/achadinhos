/**
 * T8-01 — sessão e guarda por conta.
 * Server Actions e route handlers são endpoints POST públicos: toda ação passa por `guarded`,
 * que resolve a sessão no servidor e entrega `accountId` derivado dela. O cliente nunca informa a conta.
 */
export interface Session {
  accountId: string;
  userId: string;
  /** JWT do Supabase Auth do próprio usuário, quando houver; usado só para o Realtime sob RLS. */
  accessToken?: string;
}

export interface SessionProvider {
  current(): Promise<Session | null>;
}

export type ErrorCode = "unauthorized" | "forbidden" | "invalid" | "limit" | "not_found" | "upstream";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: ErrorCode; message: string; fieldErrors?: Record<string, string> };

export class ActionError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly fieldErrors?: Record<string, string>,
  ) {
    super(message);
  }
}

const FORGED_KEYS = ["accountId", "account_id", "tenantId", "tenant_id"];

/** Entradas que trazem identificador de conta são recusadas, mesmo que coincidam com a sessão. */
export function carriesAccountId(input: unknown): boolean {
  if (!input || typeof input !== "object") return false;
  if (typeof (input as { entries?: unknown }).entries === "function" && input instanceof FormData) {
    return FORGED_KEYS.some((k) => input.has(k));
  }
  return FORGED_KEYS.some((k) => k in (input as Record<string, unknown>));
}

export function guarded<I, O>(
  provider: SessionProvider,
  handler: (session: Session, input: I) => Promise<O>,
): (input: I) => Promise<ActionResult<O>> {
  return async (input) => {
    let session: Session | null = null;
    try {
      session = await provider.current();
    } catch {
      session = null;
    }
    if (!session?.accountId || !session.userId) {
      return { ok: false, code: "unauthorized", message: "Sessão necessária." };
    }
    if (carriesAccountId(input)) {
      return { ok: false, code: "forbidden", message: "A conta é definida pela sessão." };
    }
    try {
      return { ok: true, data: await handler(session, input) };
    } catch (e) {
      if (e instanceof ActionError) {
        return { ok: false, code: e.code, message: e.message, fieldErrors: e.fieldErrors };
      }
      // Erros inesperados nunca vazam detalhe (pode conter segredo).
      return { ok: false, code: "upstream", message: "Não foi possível concluir. Tente novamente." };
    }
  };
}
