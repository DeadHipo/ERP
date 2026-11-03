import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Facade } from '../facade';
import { ValidationError } from '../shared/errors';

// The operator's trace (D-140, R5): every write needs `X-Operator` (URI-encoded name), every successful write leaves one
// row in the audit module before the response is sent, so a following GET /audit sees it.

const WRITES = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/** Params and body fields whose values identify the entities a write touched. */
const BODY_ID_FIELDS = [
  'ownerId',
  'artistId',
  'documentId',
  'isrc',
  'upc',
  'fromId',
  'intoId',
  'sellerArtistId',
  'recipientArtistId',
  'labelId',
  'paymentProofId',
];
/** Body fields copied to the summary (never names, titles, comments or aliases). */
const SUMMARY_FIELDS = [
  'amount',
  'percent',
  'validFrom',
  'validTo',
  'from',
  'effectiveFrom',
  'kind',
  'status',
  'direction',
  'reason',
];

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

function entityIdsOf(params: Record<string, unknown>, body: Record<string, unknown>): string[] {
  const ids: string[] = [];
  for (const v of Object.values(params)) if (typeof v === 'string' && v) ids.push(v);
  for (const f of BODY_ID_FIELDS) {
    const v = body[f];
    if (typeof v === 'string' && v) ids.push(v);
  }
  if (Array.isArray(body.isrcs)) for (const v of body.isrcs) if (typeof v === 'string' && v) ids.push(v);
  return [...new Set(ids)];
}

/** Ids of the created entities: the `id` of an object response, or of each element of an array response. */
function createdIdsOf(body: unknown): string[] {
  const one = (v: unknown) => {
    const id = asRecord(v).id;
    return typeof id === 'string' && id ? [id] : [];
  };
  return Array.isArray(body) ? body.flatMap(one) : one(body);
}

function summaryOf(params: Record<string, unknown>, body: Record<string, unknown>) {
  const picked: Record<string, unknown> = {};
  for (const f of SUMMARY_FIELDS) {
    const v = body[f];
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') picked[f] = v;
  }
  return { params, body: picked };
}

/** Reads and decodes the operator header; undefined when it is missing, empty or longer than 200 characters. */
function operatorOf(req: Request): string | undefined {
  const raw = req.header('x-operator');
  if (raw === undefined) return undefined;
  let name: string;
  try {
    name = decodeURIComponent(raw).trim();
  } catch {
    return undefined;
  }
  return name.length >= 1 && name.length <= 200 ? name : undefined;
}

/** Mount before the v1 router: `app.use('/api/v1', operatorTrace(facade))`. */
export function operatorTrace(facade: Facade): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!WRITES.has(req.method)) return next();
    const operator = operatorOf(req);
    if (!operator) {
      return next(
        new ValidationError('X-Operator header is required for writes', undefined, 'operator_required'),
      );
    }
    res.locals.operator = operator;

    const original = res.json.bind(res) as (body?: unknown) => Response;
    res.json = ((body?: unknown) => {
      if (res.statusCode < 200 || res.statusCode >= 300 || !req.route) return original(body);
      const params = Object.fromEntries(Object.entries(req.params).map(([k, v]) => [k, String(v)]));
      const reqBody = asRecord(req.body);
      void (async () => {
        try {
          await facade.recordAction({
            operator,
            method: req.method,
            route: String((req.route as { path: unknown }).path),
            entityIds: [...new Set([...entityIdsOf(params, reqBody), ...createdIdsOf(body)])],
            summary: summaryOf(params, reqBody),
          });
          original(body);
        } catch (e) {
          console.error(e);
          res.status(500);
          original({
            error: { code: 'audit_failed', message: 'The write was done but its trace was not saved', statusCode: 500 },
          });
        }
      })();
      return res;
    }) as typeof res.json;
    next();
  };
}
