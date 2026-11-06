import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Facade } from '../facade';
import { ValidationError } from '../shared/errors';
import { drain } from './upload';

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v !== '';

/**
 * The labels a request names: `?label=`, `body.labelId`, `body.items[].labelId` (empty strings are none);
 * `itemWithout` = an item of `body.items[]` names none. `?label=` given twice = `400 validation_error`.
 */
export function requestLabelsOf(req: Request): { labelIds: string[]; itemWithout: boolean } {
  const ids = new Set<string>();
  let itemWithout = false;
  const query = req.query as Record<string, unknown>;
  if (query.label !== undefined && typeof query.label !== 'string') throw new ValidationError('label must be one id');
  if (nonEmpty(query.label)) ids.add(query.label);
  const body: unknown = req.body;
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const b = body as Record<string, unknown>;
    if (nonEmpty(b.labelId)) ids.add(b.labelId);
    if (Array.isArray(b.items))
      for (const item of b.items as unknown[]) {
        const labelId = item && typeof item === 'object' ? (item as Record<string, unknown>).labelId : undefined;
        if (nonEmpty(labelId)) ids.add(labelId);
        else itemWithout = true;
      }
  }
  return { labelIds: [...ids], itemWithout };
}

/**
 * The labels a request names (`?label=`, `body.labelId`, `body.items[].labelId`) must be labels of the organization
 * (D-170): checked once before the route with the labels module of the organization, 404 `not_found` otherwise (a
 * foreign label is an unknown one). A second lock, not a replacement: the facade checks them too, and `400
 * label_not_own` for a sublabel stays the facade's.
 */
export function labelGuard(facade: Facade): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      for (const id of requestLabelsOf(req).labelIds) await facade.modules.labels.getLabel(id);
    } catch (e) {
      await drain(req); // an upload is refused before its body is read: let the client finish writing first
      throw e;
    }
    next();
  };
}
