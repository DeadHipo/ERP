/** Application errors carry an HTTP status and a stable code; the API maps them to a JSON envelope. */
export class AppError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown, code = 'validation_error') {
    super(message, 400, code, details);
  }
}

export class NotFoundError extends AppError {
  constructor(what: string, id: string | number) {
    super(`${what} ${id} not found`, 404, 'not_found');
  }
}

export class ConflictError extends AppError {
  constructor(message: string, code = 'conflict', details?: unknown) {
    super(message, 409, code, details);
  }
}

/** A business rule forbids the action (e.g. a payout without an approved contract). */
export class RuleViolationError extends AppError {
  constructor(message: string, code: string, details?: unknown) {
    super(message, 422, code, details);
  }
}
