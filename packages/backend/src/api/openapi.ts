import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { errorBody } from '@erp/shared/api-responses';
import { API_OPERATIONS, type ApiOperation } from './operations';

/** `/owners/:id` -> `/owners/{id}`, and the names of the path parameters. */
function openApiPath(path: string): { path: string; params: string[] } {
  const params: string[] = [];
  const out = path.replace(/:([A-Za-z]+)/g, (_m, name: string) => {
    params.push(name);
    return `{${name}}`;
  });
  return { path: out, params };
}

/** `GET /owners/:id/balance` -> `get_owners_by_id_balance`: a stable name for generated clients and MCP tools (D-177). */
export const operationIdOf = (op: Pick<ApiOperation, 'method' | 'path'>): string =>
  [op.method, ...op.path.split('/').filter(Boolean).map((s) => (s.startsWith(':') ? `by_${s.slice(1)}` : s.replace(/-/g, '_')))].join('_');

/** The field under `optional`, `nullable`, `default`. */
function unwrap(schema: z.ZodType): z.ZodType {
  let s = schema;
  while (s instanceof z.ZodOptional || s instanceof z.ZodNullable || s instanceof z.ZodDefault) s = s.unwrap() as z.ZodType;
  return s;
}

/** Every field of an answer with its description, two levels deep: `total.payable: what can be paid` (D-178). */
export function responseFieldsOf(schema: z.ZodType, prefix = '', depth = 0): string[] {
  let s = unwrap(schema);
  if (s instanceof z.ZodArray) s = unwrap(s.element as z.ZodType);
  if (!(s instanceof z.ZodObject) || depth > 1) return [];
  return Object.entries(s.shape as Record<string, z.ZodType>).flatMap(([name, field]) => {
    const path = `${prefix}${name}`;
    const text = field.description ?? unwrap(field).description;
    return [...(text && text !== 'Exact decimal string' ? [`- ${path}: ${text}`] : []), ...responseFieldsOf(field, `${path}.`, depth + 1)];
  });
}

/** The description of an operation: the summary (a client may show only this field), the errors, the response fields. */
function descriptionOf(op: ApiOperation): string {
  const fields = op.explain ? responseFieldsOf(op.response) : [];
  return [
    op.summary,
    ...(op.errors ? [`Errors:\n\n${op.errors.map((e) => `- ${e}`).join('\n')}`] : []),
    ...(fields.length ? [`Response fields:\n\n${fields.join('\n')}`] : []),
  ].join('\n\n');
}

/** The operations the read token may call (D-177): the reads of an organization. */
export const readsWithToken = (op: ApiOperation): boolean =>
  op.access === 'org' && (op.ability.action === 'read' || op.ability.action === 'read_money');

/** The OpenAPI 3.1 document of /api/v1, built from the operations list; the cookie name is the process's (D-171). */
export function buildOpenApiDocument(opts: { sessionCookie?: string } = {}) {
  const registry = new OpenAPIRegistry();
  const error = errorBody;
  // D-170: the session cookie of /auth/login (`__Host-erp_session` with AUTH_COOKIE_SECURE=1, D-171), or the system
  // key of scripts and a clean stack
  registry.registerComponent('securitySchemes', 'session', {
    type: 'apiKey',
    in: 'cookie',
    name: opts.sessionCookie ?? 'erp_session',
  });
  registry.registerComponent('securitySchemes', 'systemKey', { type: 'apiKey', in: 'header', name: 'X-System-Key' });
  // D-177: the read token (MCP_READ_TOKEN): read and read_money of ERP_DEFAULT_ORG
  registry.registerComponent('securitySchemes', 'readToken', { type: 'http', scheme: 'bearer' });
  const security: Record<ApiOperation['access'], string[]> = {
    public: [],
    user: ['session'],
    system: ['session', 'systemKey'],
    org: ['session', 'systemKey'],
  };

  for (const op of API_OPERATIONS) {
    const { path, params } = openApiPath(op.path);
    const status = op.status ?? 200;
    registry.registerPath({
      method: op.method,
      path,
      operationId: operationIdOf(op),
      tags: [op.tag],
      summary: op.summary,
      security: [...security[op.access], ...(readsWithToken(op) ? ['readToken'] : [])].map((name) => ({ [name]: [] })),
      // the right the operation needs (D-171): action, subject and, in an organization, scope
      ...(op.ability ? { 'x-ability': { ...op.ability } } : {}),
      description: descriptionOf(op),
      request: {
        ...(params.length
          ? { params: z.object(Object.fromEntries(params.map((p) => [p, z.string()]))) }
          : {}),
        ...(op.query ? { query: op.query } : {}),
        ...(op.headers?.length
          ? {
              headers: z.object(
                Object.fromEntries(
                  op.headers.map((h) => {
                    const t = z.string().describe(h.description);
                    return [h.name, h.required ? t : t.optional()];
                  }),
                ),
              ),
            }
          : {}),
        ...(op.body ? { body: { content: { 'application/json': { schema: op.body } } } } : {}),
        ...(op.upload
          ? {
              body: {
                content: {
                  'multipart/form-data': {
                    schema: z.object({ file: z.string().describe('The file (binary)') }),
                  },
                },
              },
            }
          : {}),
      },
      responses: {
        [status]: {
          description: 'OK',
          content: {
            'application/json': { schema: op.response },
            // D-173: format=csv answers one sheet as text/csv
            ...(op.csv ? { 'text/csv': { schema: z.string().describe('format=csv: UTF-8 with BOM, `;`, every field quoted') } } : {}),
          },
        },
        400: {
          description: 'Invalid input (validation_error)',
          content: { 'application/json': { schema: error } },
        },
        ...(op.access === 'public'
          ? {}
          : {
              401: {
                description: 'No session (unauthenticated)',
                content: { 'application/json': { schema: error } },
              },
              403: {
                description: 'Not allowed (forbidden)',
                content: { 'application/json': { schema: error } },
              },
            }),
        404: { description: 'Not found', content: { 'application/json': { schema: error } } },
        409: {
          description: 'Conflict with the current state',
          content: { 'application/json': { schema: error } },
        },
        422: {
          description: 'A business rule forbids it',
          content: { 'application/json': { schema: error } },
        },
      },
    });
  }

  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Royalty ERP API',
      version: '1',
      description:
        'JSON API of the music-label royalty ERP. Money and percents are exact decimal strings. Errors: `{ error: { code, message, statusCode, details, requestId } }` (500: always `internal` with the request id). Access (D-170): the session cookie of `POST /auth/login`, or `X-System-Key` for the system operations; the organization is that of the session (`X-Org` for the system administrator).',
    },
    servers: [{ url: '/api/v1' }],
  });
}
