import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { errorBody } from '@erp/shared/api-responses';
import { API_OPERATIONS } from './operations';

/** `/owners/:id` -> `/owners/{id}`, and the names of the path parameters. */
function openApiPath(path: string): { path: string; params: string[] } {
  const params: string[] = [];
  const out = path.replace(/:([A-Za-z]+)/g, (_m, name: string) => {
    params.push(name);
    return `{${name}}`;
  });
  return { path: out, params };
}

/** The OpenAPI 3.1 document of /api/v1, built from the operations list. */
export function buildOpenApiDocument() {
  const registry = new OpenAPIRegistry();
  const error = errorBody;

  for (const op of API_OPERATIONS) {
    const { path, params } = openApiPath(op.path);
    const status = op.status ?? 200;
    registry.registerPath({
      method: op.method,
      path,
      tags: [op.tag],
      summary: op.summary,
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
        'JSON API of the music-label royalty ERP. Money and percents are exact decimal strings. Errors: `{ error: { code, message, statusCode, details } }`.',
    },
    servers: [{ url: '/api/v1' }],
  });
}
