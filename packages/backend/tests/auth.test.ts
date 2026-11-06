import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createServerApp } from '../src/api/server-app';
import { API_OPERATIONS, operationKey } from '../src/api/operations';
import type { AuthConfig } from '../src/auth/middleware';
import { hashPassword, verifyPassword } from '../src/auth/password';
import { createAuthService } from '../src/auth/service';
import { nowSeconds, signToken, TOKEN_TTL_SECONDS, verifyToken } from '../src/auth/token';
import { createOrgFacades } from '../src/orgs/facades';
import { newFacade, TMP } from './helpers/fixtures';
import { testStack } from './helpers/test-sources';

// The minimal login (D-170): scrypt passwords, the HS256 session cookie, one answer for every refused login, access by
// kind of operation, the organization from the session and the audit operator from the token. Synthetic data only.

const SECRET = randomBytes(32).toString('hex');
const SYSTEM_KEY = randomBytes(24).toString('hex');
const PASSWORD = randomBytes(12).toString('hex');
const suffix = randomUUID().slice(0, 8);
const A = `auth-a-${suffix}`;
const SYS = `auth-sys-${suffix}`;
const OFF_USER = `auth-off-${suffix}`;

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const cookieOf = (res: { headers: Record<string, unknown> }) =>
  ((res.headers['set-cookie'] as string[] | undefined) ?? []).find((c) => c.startsWith('erp_session='));
const pair = (setCookie: string | undefined) => (setCookie ?? '').split(';')[0] as string;

describe('passwords and tokens (D-170)', () => {
  it('scrypt: the stored string, a round trip, a wrong password, a malformed string', async () => {
    const stored = await hashPassword('correct horse');
    expect(stored).toMatch(/^scrypt\$16384\$8\$1\$[A-Za-z0-9+/=]{24}\$[A-Za-z0-9+/=]{88}$/);
    expect(await verifyPassword('correct horse', stored)).toBe(true);
    expect(await verifyPassword('correct horsf', stored)).toBe(false);
    expect(await verifyPassword('correct horse', 'scrypt$1$2')).toBe(false);
    expect(await hashPassword('correct horse')).not.toBe(stored); // a new salt each time
  });

  it('a token: valid, forged, alg none, another header, expired', () => {
    const now = nowSeconds();
    const token = signToken('user-1', SECRET, now);
    expect(verifyToken(token, SECRET, now)).toEqual({ sub: 'user-1', iat: now, exp: now + TOKEN_TTL_SECONDS });
    const [h, body] = token.split('.') as [string, string, string];
    expect(verifyToken(`${h}.${body}.${createHmac('sha256', 'x'.repeat(32)).update(`${h}.${body}`).digest('base64url')}`, SECRET, now)).toBeNull();
    expect(verifyToken(`${b64({ alg: 'none', typ: 'JWT' })}.${body}.`, SECRET, now)).toBeNull();
    const other = b64({ typ: 'JWT', alg: 'HS256' });
    expect(verifyToken(`${other}.${body}.${createHmac('sha256', SECRET).update(`${other}.${body}`).digest('base64url')}`, SECRET, now)).toBeNull();
    expect(verifyToken(token, SECRET, now + TOKEN_TTL_SECONDS)).toBeNull();
    expect(() => signToken('user-1', 'short')).toThrow(/32 bytes/);
  });
});

describe('the login over HTTP (D-170)', () => {
  let app: Express;
  let orgId = '';
  let userA = '';
  let orgs: ReturnType<typeof createOrgFacades>;
  let auth: ReturnType<typeof createAuthService>;
  const serverApp = (config: AuthConfig) => createServerApp({ orgs, auth: { service: auth, config } });
  const login = (login: string, password = PASSWORD) =>
    request(app).post('/api/v1/auth/login').send({ login, password });

  beforeAll(async () => {
    const f = await newFacade();
    orgId = f.orgId;
    const stack = await testStack();
    await stack.reset();
    const dataDir = join(TMP, `auth-${suffix}`);
    mkdirSync(dataDir, { recursive: true });
    orgs = createOrgFacades({ stores: { db: stack.db, pool: stack.pg.pool, columnar: stack.columnar }, dataDir, payoutThresholdCents: 0 });
    auth = createAuthService(stack.db);
    userA = (await auth.createUser({ login: A, password: PASSWORD, orgId, createdBy: 'tests' })).id;
    await auth.createUser({ login: SYS, password: PASSWORD, system: true, createdBy: 'tests' });
    await expect(auth.createUser({ login: A.toUpperCase(), password: 'x', orgId, createdBy: 'tests' })).rejects.toMatchObject({ code: 'login_taken' });
    app = serverApp({ mode: 'on', secret: SECRET, systemKey: SYSTEM_KEY });
  });

  it('a login sets the session cookie with its attributes and answers me; Secure on request', async () => {
    const res = await login(A.toUpperCase()).expect(200);
    expect(cookieOf(res)).toMatch(/^erp_session=[\w-]+\.[\w-]+\.[\w-]+; HttpOnly; SameSite=Strict; Path=\/; Max-Age=43200$/);
    expect(res.body).toEqual({ authMode: 'on', user: { id: userA, login: A, isSystemAdmin: false, orgId }, org: { id: orgId, name: expect.any(String) } });
    const secure = await request(serverApp({ mode: 'on', secret: SECRET, cookieSecure: true }))
      .post('/api/v1/auth/login')
      .send({ login: A, password: PASSWORD })
      .expect(200);
    expect(cookieOf(secure)).toMatch(/; Secure$/);
  });

  it('one 401 invalid_credentials for an unknown login, a wrong password and a disabled user', async () => {
    const answers = [];
    answers.push((await login(`nobody-${suffix}`)).body);
    answers.push((await login(A, 'wrong')).body);
    const disabled = `auth-d-${suffix}`;
    await auth.createUser({ login: disabled, password: PASSWORD, orgId, createdBy: 'tests' });
    const before = pair(cookieOf(await login(disabled).expect(200)));
    await auth.setDisabled(disabled, true);
    answers.push((await login(disabled)).body);
    for (const a of answers)
      expect(a).toEqual({ error: { code: 'invalid_credentials', message: 'Wrong login or password', statusCode: 401 } });
    // the session of a user disabled later ends at once
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', before)).status).toBe(401);
    await auth.setDisabled(disabled, false);
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', before)).status).toBe(200);
    await auth.resetPassword(disabled, 'another');
    await login(disabled, 'another').expect(200);
  });

  it('forged, alg none and expired cookies are 401 unauthenticated; me and logout', async () => {
    const good = pair(cookieOf(await login(A).expect(200)));
    const me = await request(app).get('/api/v1/auth/me').set('Cookie', good).expect(200);
    expect(me.body.user.login).toBe(A);
    const [h, body] = good.slice('erp_session='.length).split('.') as [string, string];
    const bad = [
      `erp_session=${h}.${body}.${createHmac('sha256', 'y'.repeat(32)).update(`${h}.${body}`).digest('base64url')}`,
      `erp_session=${b64({ alg: 'none', typ: 'JWT' })}.${body}.`,
      `erp_session=${signToken(userA, SECRET, nowSeconds() - TOKEN_TTL_SECONDS - 1)}`,
      `erp_session=${signToken(randomUUID(), SECRET)}`, // a removed user
    ];
    for (const c of bad) {
      const res = await request(app).get('/api/v1/owners').set('Cookie', c);
      expect([res.status, res.body.error?.code], c.slice(0, 40)).toEqual([401, 'unauthenticated']);
    }
    const out = await request(app).post('/api/v1/auth/logout').set('Cookie', good).expect(200);
    expect(out.body).toEqual({ ok: true });
    expect(cookieOf(out)).toMatch(/^erp_session=; HttpOnly; SameSite=Strict; Path=\/; Max-Age=0$/);
    await request(app).post('/api/v1/auth/logout').expect(200); // idempotent, without a session too
    await request(app).get('/api/v1/auth/me').expect(401);
  });

  it('every org operation without a cookie is 401; system under a user 403; a wrong system key 403', async () => {
    const good = pair(cookieOf(await login(A).expect(200)));
    const url = (p: string) => '/api/v1' + p.replace(/:([A-Za-z]+)/g, 'x');
    for (const o of API_OPERATIONS.filter((x) => x.access === 'org')) {
      const res = await request(app)[o.method](url(o.path)).set('X-Operator', 'x').send({});
      expect([res.status, res.body.error?.code], operationKey(o)).toEqual([401, 'unauthenticated']);
    }
    for (const o of API_OPERATIONS.filter((x) => x.access === 'system')) {
      const res = await request(app)[o.method](url(o.path)).set('Cookie', good).set('X-Operator', 'x').send({});
      expect([res.status, res.body.error?.code], operationKey(o)).toEqual([403, 'forbidden']);
    }
    const wrongKey = await request(app).get('/api/v1/orgs').set('X-System-Key', 'not-the-key');
    expect([wrongKey.status, wrongKey.body.error?.code]).toEqual([403, 'forbidden']);
    await request(app).get('/api/v1/orgs').set('X-System-Key', SYSTEM_KEY).expect(200);
    const sys = pair(cookieOf(await login(SYS).expect(200)));
    await request(app).get('/api/v1/orgs').set('Cookie', sys).expect(200);
    // the key with X-Org works in an organization, as the system administrator's session does
    await request(app).get('/api/v1/owners').set('X-System-Key', SYSTEM_KEY).set('X-Org', orgId).expect(200);
    // an unknown path under /api without a session is 401 (the session is checked before the routes)
    expect((await request(app).get('/api/v1/no-such-route')).status).toBe(401);
  });

  it('the audit operator is the login of the token, not the X-Operator header', async () => {
    const good = pair(cookieOf(await login(A).expect(200)));
    const created = await request(app)
      .post('/api/v1/owners')
      .set('Cookie', good)
      .set('X-Operator', 'someone-else')
      .send({ name: 'Audit Synthetic', kind: 'person' })
      .expect(201);
    const trail = await request(app).get('/api/v1/audit').query({ entityId: created.body.id }).set('Cookie', good).expect(200);
    expect(trail.body.items[0]).toMatchObject({ operator: A, route: '/owners' });
    // the header is still required (a signature and the CSRF guard)
    const refused = await request(app).post('/api/v1/owners').set('Cookie', good).send({ name: 'No Header', kind: 'person' });
    expect(refused.body.error.code).toBe('operator_required');
  });

  it('AUTH_MODE=off: no cookie needed, the organization is ERP_DEFAULT_ORG; without it 400 org_required', async () => {
    const off = serverApp({ mode: 'off', defaultOrg: orgId });
    await request(off).get('/api/v1/owners').expect(200);
    const me = await request(off).get('/api/v1/auth/me').expect(200);
    expect(me.body).toMatchObject({ authMode: 'off', user: null, org: { id: orgId } });
    // X-Org is ignored in off
    await request(off).get('/api/v1/owners').set('X-Org', randomUUID()).expect(200);
    await auth.createUser({ login: OFF_USER, password: PASSWORD, orgId, createdBy: 'tests' });
    const noSecret = await request(off).post('/api/v1/auth/login').send({ login: OFF_USER, password: PASSWORD }).expect(200);
    expect(cookieOf(noSecret)).toBeUndefined();
    const none = await request(serverApp({ mode: 'off' })).get('/api/v1/owners');
    expect([none.status, none.body.error?.code]).toEqual([400, 'org_required']);
    const unknown = await request(serverApp({ mode: 'off', defaultOrg: randomUUID() })).get('/api/v1/owners');
    expect([unknown.status, unknown.body.error?.code]).toEqual([404, 'org_not_found']);
  });
});
