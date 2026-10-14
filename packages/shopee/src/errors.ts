export class ShopeeError extends Error {
  readonly code?: string | undefined;

  constructor(message: string, code?: string) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
  }
}

export class ShopeeSignatureError extends ShopeeError {}

export class ShopeeTimestampError extends ShopeeError {}

export class ShopeeNetworkError extends ShopeeError {}

export class ShopeeTimeoutError extends ShopeeNetworkError {}

export class ShopeeSchemaError extends ShopeeError {}

export class ShopeeGraphQLError extends ShopeeError {}
