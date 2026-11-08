import express, { type NextFunction, type Request, type Response } from 'express';
import { z, ZodError } from 'zod';
import { AppError } from '../shared/errors';
import { requestIdOf } from './request-id';

export const param = (req: Request, name: string): string => String(req.params[name]);

export function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  return schema.parse(value);
}

/** An error of `express.json` (body-parser): a malformed or oversized body. Its `body` field is the raw text. */
function isBodyParserError(err: unknown): boolean {
  const e = err as { type?: unknown; status?: unknown };
  return (
    !!e &&
    typeof e === 'object' &&
    typeof e.type === 'string' &&
    typeof e.status === 'number' &&
    e.status >= 400 &&
    e.status < 500
  );
}

/**
 * A failed drizzle query puts its parameters (the values of the request: names, amounts, a password hash) into the
 * message and the stack as `\nparams: …`: they are cut off before anything is logged.
 */
const scrub = (text: string): string => text.replace(/\nparams: [\s\S]*?(?=\n\s+at |$)/g, '\nparams: <omitted>');

/**
 * Central error handler: { error: { code, message, statusCode, details } }. A body `express.json` could not read is
 * `400 validation_error` (its raw text, a password at the login, is neither answered nor logged). Anything unexpected
 * is the constant `500 internal` with the request id; the log gets the id, the name, the message and the stack of the
 * error, never the request (body, headers, cookies) (D-170).
 */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: { code: 'validation_error', message: 'Invalid input', statusCode: 400, details: err.issues },
    });
    return;
  }
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: { code: err.code, message: err.message, statusCode: err.statusCode, details: err.details },
    });
    return;
  }
  if (isBodyParserError(err)) {
    res.status(400).json({ error: { code: 'validation_error', message: 'Malformed request body', statusCode: 400 } });
    return;
  }
  const requestId = requestIdOf(res) ?? 'none';
  const e = err instanceof Error ? err : new Error('A non-Error value was thrown');
  const code = (e.cause as { code?: unknown } | undefined)?.code;
  console.error(
    `[${requestId}] ${e.name}: ${scrub(e.message)}${code !== undefined ? ` (code ${String(code)})` : ''}\n${scrub(e.stack ?? '')}`,
  );
  res.status(500).json({ error: { code: 'internal', message: 'Internal error', statusCode: 500, requestId } });
}

/**
 * The JSON body parser of the API: 1 MB, except the paths that carry a whole accepted preview (D-195: the release
 * changes of an export, about 8 000 rows): 20 MB.
 */
const LARGE_BODY_PATHS = new Set(['/api/v1/releases/preview/apply']);
export function jsonBody() {
  const small = express.json({ limit: '1mb' });
  const large = express.json({ limit: '20mb' });
  return (req: Request, res: Response, next: NextFunction) => (LARGE_BODY_PATHS.has(req.path) ? large : small)(req, res, next);
}
