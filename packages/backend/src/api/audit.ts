import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Facade } from '../facade';
import { ValidationError } from '../shared/errors';
import { sessionUserOf } from '../auth/middleware';

// The operator's trace (D-140, R5): every write needs `X-Operator` (URI-encoded name), every successful write leaves one
// row in the audit module before the response is sent, so a following GET /audit sees it.
// If the record fails after the handler has committed, the write is NOT reported as failed (a retry could duplicate an
// advance): the failure is logged, the 2xx response goes out with the header `X-Audit: failed` (D-150).

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
/** Body fields copied to the summary (never names, titles, comments, aliases or a free-text `reason`). */
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
  'recoveryPercent',
  'scope',
  'labelId',
  // the members and the support grants (D-171): never the login or the password
  'role',
  'active',
  'write',
  'expiresAt',
];
/** Summary fields kept even when null: clearing them is the write (`PATCH /documents/:id { labelId: null }`, D-169). */
const NULLABLE_SUMMARY_FIELDS = new Set(['labelId']);

/**
 * The writes whose own label is only in the response (D-169, R11): the operation, record or document they act on
 * carries it. An explicit list: a rule's response (`POST /labels/:id/rules`, `/labels/rules/:id/close`) also has a
 * `labelId`, but it is a sublabel, never recorded.
 */
export const RESPONSE_LABEL_ROUTES = new Set([
  'PATCH /settlements/operations/:id',
  'POST /settlements/operations/:id/proof',
  'POST /settlements/operations/:id/deferred',
  'POST /settlements/operations/:id/deactivate',
  'POST /settlements/operations/:id/return',
  'PATCH /ads/:id',
  'POST /ads/:id/deactivate',
  'PATCH /documents/:id',
  'POST /documents/:id/attach',
  'POST /documents/:id/approve',
]);

const nonEmpty = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

/**
 * The own label of a write (D-169), in this order: `?label=` → `body.labelId` → the one distinct `labelId` of
 * `body.items[]` (`POST /ads`) → the `labelId` of the response for `RESPONSE_LABEL_ROUTES` → null.
 */
export function labelOfWrite(
  routeKey: string,
  query: Record<string, unknown>,
  body: Record<string, unknown>,
  response: unknown,
): string | null {
  const fromQuery = nonEmpty(query.label);
  if (fromQuery) return fromQuery;
  const fromBody = nonEmpty(body.labelId);
  if (fromBody) return fromBody;
  if (Array.isArray(body.items)) {
    const ids = new Set(body.items.map((i) => nonEmpty(asRecord(i).labelId)).filter((x): x is string => !!x));
    if (ids.size === 1) return [...ids][0] as string;
  }
  if (RESPONSE_LABEL_ROUTES.has(routeKey)) return nonEmpty(asRecord(response).labelId) ?? null;
  return null;
}

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
  if (Array.isArray(body)) return body.flatMap(one);
  // a batch (POST /ads): the ids of the created records
  const created = asRecord(body).created;
  if (Array.isArray(created)) return created.flatMap(one);
  return one(body);
}

function summaryOf(params: Record<string, unknown>, body: Record<string, unknown>) {
  const picked: Record<string, unknown> = {};
  for (const f of SUMMARY_FIELDS) {
    const v = body[f];
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') picked[f] = v;
    else if (v === null && NULLABLE_SUMMARY_FIELDS.has(f)) picked[f] = null;
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

/** The operator of a write: the login of the session (`AUTH_MODE=on`), else the `X-Operator` header (D-170). */
function writeOperator(req: Request, res: Response): string | undefined {
  const header = operatorOf(req);
  if (!header) return undefined; // the header is required on every write either way (a signature, and CSRF)
  return sessionUserOf(res)?.login ?? header;
}

interface TraceTarget {
  /** The facade whose audit module records the row. */
  facade: Pick<Facade, 'recordAction'>;
  entityIds: string[];
  /** `support: true` marks a write of the system administrator working under a support grant (D-171). */
  summary: { params: Record<string, unknown>; body: Record<string, unknown>; support?: true };
  labelId: string | null;
}

/** A write of the system administrator under a support grant (`resolveOrg` set the principal, D-171). */
const bySupport = (res: Response): boolean => (res.locals.principal as { kind?: string } | undefined)?.kind === 'support';

/**
 * Requires `X-Operator` on a write and records one audit row after a 2xx answer, before it is sent; `target` decides
 * where and what (after the handler: the route, the params and the response are known).
 */
function traceWrites(
  /** null = no row (a write outside any organization: the system administrator's own password, D-171). */
  target: (
    req: Request,
    route: string,
    params: Record<string, string>,
    response: unknown,
    res: Response,
  ) => Promise<TraceTarget | null>,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!WRITES.has(req.method)) return next();
    const operator = writeOperator(req, res);
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
      const route = String((req.route as { path: unknown }).path);
      void (async () => {
        try {
          const t = await target(req, route, params, body, res);
          if (t) await t.facade.recordAction({
            operator,
            method: req.method,
            route,
            entityIds: t.entityIds,
            summary: t.summary,
            labelId: t.labelId,
          });
          original(body);
        } catch (e) {
          console.error('audit record failed after a committed write', (e as Error)?.message);
          res.setHeader('X-Audit', 'failed');
          original(body);
        }
      })();
      return res;
    }) as typeof res.json;
    next();
  };
}

/** Mount before the routes of an organization: every write of the organization leaves a row in its audit. */
export function operatorTrace(facade: Facade): RequestHandler {
  return traceWrites(async (req, route, params, body, res) => {
    const reqBody = asRecord(req.body);
    return {
      facade,
      entityIds: [...new Set([...entityIdsOf(params, reqBody), ...createdIdsOf(body)])],
      summary: { ...summaryOf(params, reqBody), ...(bySupport(res) ? { support: true as const } : {}) },
      labelId: labelOfWrite(`${req.method} ${route}`, asRecord(req.query), reqBody, body),
    };
  });
}

/**
 * The writes of the system administrator (`/orgs*`, D-170): the row goes into the audit of the target organization
 * (`:id`, or the `id` of the created organization); the entity ids are the organization and the created user; the
 * summary keeps neither the login nor the password nor the name.
 */
export function systemTrace(facadeOf: (orgId: string) => Promise<Pick<Facade, 'recordAction'>>): RequestHandler {
  return traceWrites(async (req, route, params, body) => {
    const created = asRecord(body);
    const orgId = params.id ?? (typeof created.id === 'string' ? created.id : '');
    const ids = [orgId, ...(params.id && typeof created.id === 'string' ? [created.id] : [])].filter((x) => !!x);
    if (params.userId) ids.push(params.userId);
    // the role and the state of a membership, never a login or a password; entering as support is marked (D-171)
    const picked = summaryOf({}, asRecord(req.body)).body;
    const support = route === '/orgs/:id/support/enter' ? { support: true as const } : {};
    return { facade: await facadeOf(orgId), entityIds: [...new Set(ids)], summary: { params, body: picked, ...support }, labelId: null };
  });
}

/**
 * The writes on a user outside any organization (`/system/users*`, D-171): `X-Operator` is required as on every
 * write, no audit row (no organization); the route logs the request id, the target and the outcome.
 */
export const noOrgTrace = (): RequestHandler => traceWrites(async () => null);

/**
 * The user's own writes (`POST /auth/password`, D-171): a member's row goes into the audit of the session's
 * organization, without any value (the operator = the login, no entity but the user); a system administrator has no
 * organization, so no row.
 */
export function selfTrace(facadeOf: (orgId: string) => Promise<Pick<Facade, 'recordAction'>>): RequestHandler {
  return traceWrites(async (_req, _route, params, _body, res) => {
    const user = sessionUserOf(res);
    if (!user?.orgId) return null;
    return { facade: await facadeOf(user.orgId), entityIds: [user.id], summary: { params, body: {} }, labelId: null };
  });
}
