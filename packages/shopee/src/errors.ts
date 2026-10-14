export class ShopeeError extends Error {
  readonly code?: string | undefined;

  constructor(message: string, code?: string) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
  }
}

export class ShopeeSignatureError extends ShopeeError {
  /** Status HTTP quando a Shopee entrega o erro de assinatura em resposta não-2xx. */
  readonly status?: number | undefined;

  constructor(message: string, code?: string, status?: number) {
    super(message, code);
    this.status = status;
  }
}

export class ShopeeTimestampError extends ShopeeError {}

export class ShopeeNetworkError extends ShopeeError {}

/** Resposta HTTP não-2xx; `status` distingue 429/5xx de indisponibilidade de rede. */
export class ShopeeHttpError extends ShopeeNetworkError {
  readonly status: number;

  constructor(status: number, code = "HTTP") {
    super(`HTTP ${status}`, code);
    this.status = status;
  }
}

/** Configuração inválida (ex.: endpoint fora da allowlist). Nunca ecoa credenciais. */
export class ShopeeConfigError extends ShopeeError {}

export class ShopeeTimeoutError extends ShopeeNetworkError {}

export class ShopeeSchemaError extends ShopeeError {}

export class ShopeeGraphQLError extends ShopeeError {}
