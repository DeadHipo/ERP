import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildOpenApiDocument, operationIdOf } from '../src/api/openapi';
import { API_OPERATIONS } from '../src/api/operations';
import { createServerApp } from '../src/api/server-app';
import { authConfigFromEnv, type AuthConfig } from '../src/auth/middleware';
import { createAuthService } from '../src/auth/service';
import { createOrgFacades } from '../src/orgs/facades';
import { newFacade, TMP } from './helpers/fixtures';
import { testStack } from './helpers/test-sources';

// The read token and the paging of the long lists (D-177). The token is checked on the real chain in both modes, on
// every operation that is not a read. Synthetic data only.

const TOKEN = randomBytes(32).toString('hex');
const SECRET = randomBytes(32).toString('hex');
const bearer = (t = TOKEN) => ({ Authorization: `Bearer ${t}` });

describe('the read token and the paging (D-177)', () => {
  let off: Express;
  let on: Express;
  let orgId = '';

  beforeAll(async () => {
    const f = await newFacade();
    orgId = f.orgId;
    const stack = await testStack();
    await stack.reset();
    const dataDir = join(TMP, `read-token-${randomUUID().slice(0, 8)}`);
    mkdirSync(dataDir, { recursive: true });
    const orgs = createOrgFacades({ stores: { db: stack.db, pool: stack.pg.pool, columnar: stack.columnar }, dataDir, payoutThresholdCents: 0 });
    const service = createAuthService(stack.db);
    const app = (config: AuthConfig) => createServerApp({ orgs, auth: { service, config } });
    off = app({ mode: 'off', defaultOrg: orgId, readToken: TOKEN });
    on = app({ mode: 'on', secret: SECRET, defaultOrg: orgId, readToken: TOKEN });
    for (let i = 0; i < 60; i++)
      await request(off).post('/api/v1/owners').set('X-Operator', 'tests').send({ name: `Owner ${i}`, kind: 'person', force: true }).expect(201);
  });

  it('a session keeps the whole list as a bare array; limit and offset give a page with the total', async () => {
    const whole = await request(off).get('/api/v1/owners').expect(200);
    expect(Array.isArray(whole.body)).toBe(true);
    const n = (whole.body as unknown[]).length;
    expect(n).toBeGreaterThanOrEqual(60);

    const page = await request(off).get('/api/v1/owners?limit=2&offset=1').expect(200);
    expect(page.body).toEqual({ total: n, limit: 2, offset: 1, items: (whole.body as unknown[]).slice(1, 3) });
    const onlyOffset = await request(off).get('/api/v1/owners?offset=55').expect(200);
    expect(onlyOffset.body).toMatchObject({ total: n, limit: 50, offset: 55 });
    await request(off).get('/api/v1/owners?limit=501').expect(400);
  });

  it('an answer with its own fields keeps them: the page sits beside them', async () => {
    const whole = await request(off).get('/api/v1/owners/payables').expect(200);
    expect(whole.body).not.toHaveProperty('total');
    const page = await request(off).get('/api/v1/owners/payables?limit=3').expect(200);
    expect(page.body).toMatchObject({ calculatedAt: expect.any(String), limit: 3, offset: 0, total: (whole.body as { items: unknown[] }).items.length });
    expect((page.body as { items: unknown[] }).items).toHaveLength(3);
  });

  it.each([
    ['off', () => off],
    ['on', () => on],
  ])('AUTH_MODE=%s: the token reads, paged by default', async (_mode, app) => {
    const res = await request(app()).get('/api/v1/owners').set(bearer()).expect(200);
    expect(res.body).toMatchObject({ limit: 50, offset: 0 });
    expect((res.body as { items: unknown[] }).items).toHaveLength(50);
    await request(app()).get('/api/v1/owners/payables').set(bearer()).expect(200);
    await request(app()).get('/api/v1/splits').set(bearer()).expect(200);
  });

  it.each([
    ['off', () => off],
    ['on', () => on],
  ])('AUTH_MODE=%s: every operation that is not a read refuses the token', async (_mode, app) => {
    const closed = API_OPERATIONS.filter((o) => o.ability && o.ability.action !== 'read' && o.ability.action !== 'read_money');
    expect(closed.length).toBeGreaterThan(50);
    for (const op of closed) {
      const path = `/api/v1${op.path.replace(/:[A-Za-z]+/g, 'x')}`;
      const res = await request(app())[op.method](path).set(bearer()).set('X-Operator', 'tests').send({});
      expect(`${op.method} ${op.path} ${res.status}`).toBe(`${op.method} ${op.path} 403`);
    }
  }, 120_000);

  it('a wrong token or another scheme is 401 even in AUTH_MODE=off; a token without a configured one too', async () => {
    await request(off).get('/api/v1/owners').set(bearer('x'.repeat(64))).expect(401);
    await request(off).get('/api/v1/owners').set('Authorization', 'Basic abc').expect(401);
    await request(on).get('/api/v1/owners').set(bearer('x'.repeat(64))).expect(401);
    await request(on).get('/api/v1/owners').expect(401);
  });

  it('another organization by X-Org is refused', async () => {
    await request(on).get('/api/v1/owners').set(bearer()).set('X-Org', randomUUID()).expect(403);
    await request(on).get('/api/v1/owners').set(bearer()).set('X-Org', orgId).expect(200);
  });

  it('the setting: a short token stops the start, an empty one turns the path off', () => {
    expect(() => authConfigFromEnv({ AUTH_MODE: 'off', MCP_READ_TOKEN: 'short' })).toThrow(/32 characters/);
    expect(authConfigFromEnv({ AUTH_MODE: 'off', MCP_READ_TOKEN: '' }).readToken).toBeUndefined();
    expect(authConfigFromEnv({ AUTH_MODE: 'off', MCP_READ_TOKEN: TOKEN }).readToken).toBe(TOKEN);
  });

  it('every operation has a unique readable operationId of at most 64 characters', () => {
    const ids = API_OPERATIONS.map(operationIdOf);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][A-Za-z0-9_]{0,63}$/);
    expect(operationIdOf({ method: 'get', path: '/owners/:id/balance' })).toBe('get_owners_by_id_balance');
    const doc = buildOpenApiDocument();
    expect(doc.paths?.['/owners/{id}/balance']?.get?.operationId).toBe('get_owners_by_id_balance');
  });
});
