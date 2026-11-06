import type { Request, RequestHandler } from 'express';
import { z } from 'zod';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { MCP_INSTRUCTIONS } from '@erp/shared/mcp-connection';
import { hasReadToken } from '../auth/middleware';
import { ForbiddenError, UnauthenticatedError } from '../shared/errors';
import { descriptionOf, operationIdOf, readsWithToken } from './openapi';
import { API_OPERATIONS, type ApiOperation } from './operations';

// The remote MCP endpoint for Claude (D-180): `POST /api/mcp`, Streamable HTTP, stateless, only with the read token.
// A tool is a read of `operations.ts`; its call goes back through this server's own HTTP API with the same token, so
// the rights, the paging and the errors are those of the API and this file decides nothing about data.

const HIDDEN_TAGS = new Set(['auth', 'orgs', 'users']);

export const MCP_OPERATIONS: readonly ApiOperation[] = API_OPERATIONS.filter(
  (op) => op.method === 'get' && readsWithToken(op) && !HIDDEN_TAGS.has(op.tag),
);

export const mcpToolName = (op: ApiOperation): string => operationIdOf(op).replace(/_/g, '-');

const pathParams = (op: ApiOperation): string[] => [...op.path.matchAll(/:([A-Za-z]+)/g)].map((m) => m[1] as string);

/** The input of a tool: the path parameters and the query of the operation, as JSON Schema. */
export function mcpInputSchema(op: ApiOperation) {
  const query = op.query ? (z.toJSONSchema(op.query, { unrepresentable: 'any' }) as { properties?: Record<string, unknown> }) : {};
  const params = pathParams(op);
  const shape = (op.query?.shape ?? {}) as Record<string, z.ZodType>;
  const required = [...params, ...Object.entries(shape).filter(([, field]) => !field.safeParse(undefined).success).map(([name]) => name)];
  return {
    type: 'object' as const,
    properties: { ...Object.fromEntries(params.map((p) => [p, { type: 'string' }])), ...query.properties },
    ...(required.length ? { required } : {}),
  };
}

/** The path and query of a call: the path parameters go into the path, the rest into the query. */
export function mcpRequestPath(op: ApiOperation, args: Record<string, unknown>): string {
  const params = new Set(pathParams(op));
  const path = op.path.replace(/:([A-Za-z]+)/g, (_m, name: string) => encodeURIComponent(String(args[name] as string)));
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(args))
    if (!params.has(name) && value !== undefined && value !== null) query.set(name, String(value as string));
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}

function mcpServer(base: string, authorization: string): Server {
  const server = new Server({ name: 'erp', version: '1.0.0' }, { capabilities: { tools: {} }, instructions: MCP_INSTRUCTIONS });
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: MCP_OPERATIONS.map((op) => ({ name: mcpToolName(op), description: descriptionOf(op), inputSchema: mcpInputSchema(op) })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const op = MCP_OPERATIONS.find((o) => mcpToolName(o) === request.params.name);
    if (!op) return { content: [{ type: 'text' as const, text: `Unknown tool ${request.params.name}` }], isError: true };
    const res = await fetch(`${base}${mcpRequestPath(op, request.params.arguments ?? {})}`, { headers: { authorization } });
    return { content: [{ type: 'text' as const, text: await res.text() }], isError: !res.ok };
  });
  return server;
}

const ownBase = (req: Request): string => `http://127.0.0.1:${req.socket.localPort}/api/v1`;

/** Mount on `/api/mcp`, after the authentication: only the read token, whatever `AUTH_MODE` is. */
export function mcpEndpoint(): RequestHandler {
  return async (req, res) => {
    if (!hasReadToken(res)) throw new UnauthenticatedError();
    if (req.method !== 'POST') {
      if (req.method === 'GET' || req.method === 'DELETE') {
        res.status(405).set('Allow', 'POST').json({ error: { code: 'method_not_allowed', message: 'Stateless MCP: POST only', statusCode: 405 } });
        return;
      }
      throw new ForbiddenError('POST only');
    }
    const server = mcpServer(ownBase(req), req.header('authorization') as string);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  };
}
