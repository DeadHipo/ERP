import type { NextFunction, Request, Response } from 'express';
import { z, ZodError } from 'zod';
import { AppError } from '../shared/errors';

export const param = (req: Request, name: string): string => String(req.params[name]);

export function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  return schema.parse(value);
}

/** Central error handler: { error: { code, message, statusCode, details } }. */
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
  console.error(err);
  res.status(500).json({
    error: { code: 'internal', message: (err as Error).message ?? 'Internal error', statusCode: 500 },
  });
}
