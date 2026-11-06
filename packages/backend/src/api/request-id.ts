import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/** Every request gets an id (D-170): `res.locals.requestId` and the response header `X-Request-Id`. */
export function requestId(_req: Request, res: Response, next: NextFunction): void {
  const id = randomUUID();
  res.locals.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
}

/** The id of the request, if `requestId` ran. */
export const requestIdOf = (res: Response): string | undefined =>
  typeof res.locals.requestId === 'string' ? res.locals.requestId : undefined;
