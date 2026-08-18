export class SiiValidationError extends Error {
  constructor(
    message: string,
    public readonly details: string[] = [],
  ) {
    super(message);
    this.name = 'SiiValidationError';
  }
}

export class SiiConnectionError extends Error {
  constructor(
    message: string,
    public readonly causeCode?: string,
  ) {
    super(message);
    this.name = 'SiiConnectionError';
  }
}
