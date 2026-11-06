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
      tags: [op.tag],
      summary: op.summary,
      security: security[op.access].map((name) => ({ [name]: [] })),
      // the right the operation needs (D-171): action, subject and, in an organization, scope
      ...(op.ability ? { 'x-ability': { ...op.ability } } : {}),
      ...(op.errors ? { description: `Errors:\n\n${op.errors.map((e) => `- ${e}`).join('\n')}` } : {}),
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
          content: { 'application/json': { schema: op.response } },
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
