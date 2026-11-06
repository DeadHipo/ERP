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

/** No session: no cookie, a bad or expired token, a disabled or removed user (D-170). */
export class UnauthenticatedError extends AppError {
  constructor(message = 'Not signed in', code = 'unauthenticated') {
    super(message, 401, code);
  }
}

/**
 * A session that may not do this (D-170): a system operation, `X-Org` from a user, a wrong system key; D-171 codes:
 * `no_membership`, `csrf`.
 */
export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden', code = 'forbidden', details?: unknown) {
    super(message, 403, code, details);
  }
}

/** `429 too_many_attempts` (D-171): the login limit; the route sets `Retry-After`. */
export class TooManyAttemptsError extends AppError {
  constructor(readonly retryAfterSeconds: number) {
    super('Too many attempts: try again later', 429, 'too_many_attempts', { retryAfterSeconds });
  }
}
