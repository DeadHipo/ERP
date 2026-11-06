import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createHmac, randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createServerApp } from '../src/api/server-app';
import { API_OPERATIONS, operationKey } from '../src/api/operations';
import { authConfigFromEnv, type AuthConfig } from '../src/auth/middleware';
import { hashPassword, needsRehash, verifyPassword } from '../src/auth/password';
import { createAuthService } from '../src/auth/service';
import { nowSeconds, signToken, TOKEN_TTL_SECONDS, verifyToken } from '../src/auth/token';
import { createOrgFacades } from '../src/orgs/facades';
import { createOrgsService } from '../src/orgs/service';
import { newFacade, TMP } from './helpers/fixtures';
import { testStack } from './helpers/test-sources';

// The login (D-170, D-171): scrypt passwords, the HS256 session cookie with a session row, one answer for every refused
// login, the organization chosen at the login, the limit of failed attempts, the cookie name, the Origin rule, access
// by kind of operation, the organization from the session and the audit operator from the token. Synthetic data only.

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
    expect(stored).toMatch(/^scrypt\$32768\$8\$1\$[A-Za-z0-9+/=]{24}\$[A-Za-z0-9+/=]{88}$/);
    expect(needsRehash(stored)).toBe(false);
    expect(await verifyPassword('correct horse', stored)).toBe(true);
    expect(await verifyPassword('correct horsf', stored)).toBe(false);
    expect(await verifyPassword('correct horse', 'scrypt$1$2')).toBe(false);
    expect(await hashPassword('correct horse')).not.toBe(stored); // a new salt each time
  });

  it('an old hash (N=16384 of stage 2) still verifies and asks for a rehash', async () => {
    const salt = randomBytes(16);
    const key = scryptSync('old one', salt, 64, { N: 16384, r: 8, p: 1 });
    const old = `scrypt$16384$8$1$${salt.toString('base64')}$${key.toString('base64')}`;
    expect(await verifyPassword('old one', old)).toBe(true);
    expect(needsRehash(old)).toBe(true);
  });

  it('a token: valid, forged, alg none, another header, expired, without sid (stage 2)', () => {
    const now = nowSeconds();
    const token = signToken('user-1', 'session-1', SECRET, now);
    expect(verifyToken(token, SECRET, now)).toEqual({ sub: 'user-1', sid: 'session-1', iat: now, exp: now + TOKEN_TTL_SECONDS });
    const [h, body] = token.split('.') as [string, string, string];
    expect(verifyToken(`${h}.${body}.${createHmac('sha256', 'x'.repeat(32)).update(`${h}.${body}`).digest('base64url')}`, SECRET, now)).toBeNull();
    expect(verifyToken(`${b64({ alg: 'none', typ: 'JWT' })}.${body}.`, SECRET, now)).toBeNull();
    const other = b64({ typ: 'JWT', alg: 'HS256' });
    expect(verifyToken(`${other}.${body}.${createHmac('sha256', SECRET).update(`${other}.${body}`).digest('base64url')}`, SECRET, now)).toBeNull();
    expect(verifyToken(token, SECRET, now + TOKEN_TTL_SECONDS)).toBeNull();
    expect(() => signToken('user-1', 'session-1', 'short')).toThrow(/32 bytes/);
    const noSid = b64({ sub: 'user-1', iat: now, exp: now + 60 });
    expect(verifyToken(`${h}.${noSid}.${createHmac('sha256', SECRET).update(`${h}.${noSid}`).digest('base64url')}`, SECRET, now)).toBeNull();
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
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({
      authMode: 'on',
      user: { id: userA, login: A, isSystemAdmin: false },
      org: { id: orgId, name: expect.any(String) },
      role: 'org_admin',
      labels: expect.arrayContaining([expect.objectContaining({ name: '0to8' })]),
      allLabels: true,
      memberships: [{ orgId, orgName: expect.any(String), role: 'org_admin' }],
      support: null,
      abilities: expect.arrayContaining(['GET /auth/me', 'POST /owners/merge', 'GET /overview']),
    });
    expect(res.body.abilities).not.toContain('GET /orgs'); // an organization administrator has no system operation
  });

  it('AUTH_COOKIE_SECURE=1: the cookie __Host-erp_session with Secure, read and cleared by the same name', async () => {
    const secureApp = serverApp({ mode: 'on', secret: SECRET, cookieSecure: true });
    const res = await request(secureApp).post('/api/v1/auth/login').send({ login: A, password: PASSWORD }).expect(200);
    const set = ((res.headers['set-cookie'] as string[] | undefined) ?? [])[0] ?? '';
    expect(set).toMatch(/^__Host-erp_session=[\w-]+\.[\w-]+\.[\w-]+; HttpOnly; SameSite=Strict; Path=\/; Max-Age=43200; Secure$/);
    const cookie = pair(set);
    await request(secureApp).get('/api/v1/auth/me').set('Cookie', cookie).expect(200);
    // the other name is not read by this process
    await request(secureApp).get('/api/v1/auth/me').set('Cookie', cookie.replace('__Host-erp_session', 'erp_session')).expect(401);
    const out = await request(secureApp).post('/api/v1/auth/logout').set('Cookie', cookie).expect(200);
    expect((out.headers['set-cookie'] as unknown as string[])[0]).toBe('__Host-erp_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0; Secure');
    await request(secureApp).get('/api/v1/auth/me').set('Cookie', cookie).expect(401); // the session is revoked
    const doc = await request(secureApp).get('/api/v1/openapi.json').expect(200);
    expect(doc.body.components.securitySchemes.session.name).toBe('__Host-erp_session');
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
    // disabling revoked the session (D-171): enabling again does not bring it back
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', before)).status).toBe(401);
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
      `erp_session=${signToken(userA, randomUUID(), SECRET, nowSeconds() - TOKEN_TTL_SECONDS - 1)}`,
      `erp_session=${signToken(randomUUID(), randomUUID(), SECRET)}`, // a removed user
      `erp_session=${signToken(userA, randomUUID(), SECRET)}`, // a well-signed token of no session
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
    // logout revoked the session: the copied cookie is dead (D-171)
    await request(app).get('/api/v1/auth/me').set('Cookie', good).expect(401);
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
    // the key never works in an organization, the system administrator's session only under a support grant (D-171)
    const key = await request(app).get('/api/v1/owners').set('X-System-Key', SYSTEM_KEY).set('X-Org', orgId);
    expect([key.status, key.body.error?.code]).toEqual([403, 'support_required']);
    const noGrant = await request(app).get('/api/v1/owners').set('Cookie', sys).set('X-Org', orgId);
    expect([noGrant.status, noGrant.body.error?.code]).toEqual([403, 'support_required']);
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
    expect(me.body).toMatchObject({ authMode: 'off', user: null, org: { id: orgId }, role: 'local', allLabels: true, memberships: [] });
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

describe('the login of stage 3: memberships, the limit, Origin (D-171)', () => {
  let orgs: ReturnType<typeof createOrgFacades>;
  let auth: ReturnType<typeof createAuthService>;
  let pool: Awaited<ReturnType<typeof testStack>>['pg']['pool'];
  let orgA = '';
  let orgB = '';
  const MULTI = `auth-m-${suffix}`;
  const LONE = `auth-n-${suffix}`;
  const serverApp = (config: Partial<AuthConfig> = {}) =>
    createServerApp({ orgs, auth: { service: auth, config: { mode: 'on', secret: SECRET, ...config } } });
  const userIdOf = `(SELECT id FROM auth.users WHERE login = $2)`;

  beforeAll(async () => {
    const f = await newFacade();
    orgA = f.orgId;
    const stack = await testStack();
    pool = stack.pg.pool;
    const dataDir = join(TMP, `auth3-${suffix}`);
    mkdirSync(dataDir, { recursive: true });
    orgs = createOrgFacades({ stores: { db: stack.db, pool: stack.pg.pool, columnar: stack.columnar }, dataDir, payoutThresholdCents: 0 });
    auth = createAuthService(stack.db);
    orgB = (await createOrgsService(stack.db).createOrganization({ name: `Auth B ${suffix}`, createdBy: 'tests' })).id;
    await auth.createUser({ login: MULTI, password: PASSWORD, orgId: orgA, role: 'org_admin', createdBy: 'tests' });
    await auth.addMembership({ login: MULTI, orgId: orgB, role: 'org_admin', labelIds: [], createdBy: 'tests' });
    await auth.createUser({ login: LONE, password: PASSWORD, orgId: orgA, role: 'org_admin', createdBy: 'tests' });
    await pool.query(`UPDATE auth.memberships SET disabled_at = now() WHERE org_id = $1 AND user_id = ${userIdOf}`, [orgA, LONE]);
  });

  it('several memberships: 409 org_choice_required with the organizations, then orgId signs into that one', async () => {
    const app = serverApp();
    const choose = await request(app).post('/api/v1/auth/login').send({ login: MULTI, password: PASSWORD }).expect(409);
    expect(choose.body.error.code).toBe('org_choice_required');
    expect(choose.headers['set-cookie']).toBeUndefined();
    const listed = (choose.body.error.details.orgs as { id: string; role: string }[]).map((o) => `${o.id} ${o.role}`).sort();
    expect(listed).toEqual([`${orgA} org_admin`, `${orgB} org_admin`].sort());
    // a wrong password never shows the organizations
    const wrong = await request(app).post('/api/v1/auth/login').send({ login: MULTI, password: 'nope' }).expect(401);
    expect(wrong.body.error.details).toBeUndefined();
    // an orgId that is not theirs: the choice again
    const foreign = await request(app).post('/api/v1/auth/login').send({ login: MULTI, password: PASSWORD, orgId: randomUUID() }).expect(409);
    expect(foreign.body.error.code).toBe('org_choice_required');
    const inB = await request(app).post('/api/v1/auth/login').send({ login: MULTI, password: PASSWORD, orgId: orgB }).expect(200);
    expect(inB.body).toMatchObject({ org: { id: orgB }, role: 'org_admin' });
    expect((inB.body.memberships as { orgId: string }[]).map((m) => m.orgId).sort()).toEqual([orgA, orgB].sort());
    const cookie = pair(cookieOf(inB));
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', cookie).expect(200)).body.org.id).toBe(orgB);
    await request(app).get('/api/v1/owners').set('Cookie', cookie).expect(200);
  });

  it('no active membership: 403 no_membership', async () => {
    const res = await request(serverApp()).post('/api/v1/auth/login').send({ login: LONE, password: PASSWORD }).expect(403);
    expect(res.body.error.code).toBe('no_membership');
  });

  it('a role change acts on the next request', async () => {
    const app = serverApp();
    const signed = await request(app).post('/api/v1/auth/login').send({ login: MULTI, password: PASSWORD, orgId: orgA }).expect(200);
    const cookie = pair(cookieOf(signed));
    const label = (await (await orgs.get(orgA)).facade.modules.labels.listLabels()).find((l) => l.kind === 'own');
    await pool.query(`UPDATE auth.memberships SET role = 'label_manager' WHERE org_id = $1 AND user_id = ${userIdOf}`, [orgA, MULTI]);
    await pool.query(
      `INSERT INTO auth.user_labels (user_id, org_id, label_id, created_by) SELECT id, $1, $3, 'tests' FROM auth.users WHERE login = $2`,
      [orgA, MULTI, label?.id],
    );
    const me = await request(app).get('/api/v1/auth/me').set('Cookie', cookie).expect(200);
    expect(me.body).toMatchObject({ role: 'label_manager', allLabels: false, labels: [{ id: label?.id, name: label?.name }] });
    await pool.query(`DELETE FROM auth.user_labels WHERE org_id = $1 AND user_id = ${userIdOf}`, [orgA, MULTI]);
    await pool.query(`UPDATE auth.memberships SET role = 'org_admin' WHERE org_id = $1 AND user_id = ${userIdOf}`, [orgA, MULTI]);
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', cookie).expect(200)).body.role).toBe('org_admin');
  });

  it('an old hash is rehashed at a successful login', async () => {
    const login = `auth-r-${suffix}`;
    await auth.createUser({ login, password: PASSWORD, orgId: orgA, createdBy: 'tests' });
    const salt = randomBytes(16);
    const key = scryptSync(PASSWORD, salt, 64, { N: 16384, r: 8, p: 1 });
    await pool.query('UPDATE auth.users SET password_hash = $1 WHERE login = $2', [
      `scrypt$16384$8$1$${salt.toString('base64')}$${key.toString('base64')}`,
      login,
    ]);
    await request(serverApp()).post('/api/v1/auth/login').send({ login, password: PASSWORD }).expect(200);
    const { rows } = await pool.query<{ password_hash: string }>('SELECT password_hash FROM auth.users WHERE login = $1', [login]);
    expect(rows[0]?.password_hash).toMatch(/^scrypt\$32768\$/);
  });

  it('the limit (AUTH_LOGIN_LIMIT=2): failed attempts only; the third is 429 with Retry-After; a success resets', async () => {
    const app = serverApp({ loginLimit: 2 });
    const user = `auth-l-${suffix}`;
    await auth.createUser({ login: user, password: PASSWORD, orgId: orgA, createdBy: 'tests' });
    const attempt = (password: string) => request(app).post('/api/v1/auth/login').send({ login: user, password });
    for (let i = 0; i < 4; i++) await attempt(PASSWORD).expect(200); // successes do not count
    await attempt('wrong').expect(401);
    await attempt(PASSWORD).expect(200); // resets the counter of the login
    await attempt('wrong').expect(401);
    await attempt('wrong').expect(401);
    const limited = await attempt('wrong').expect(429);
    expect(limited.body.error.code).toBe('too_many_attempts');
    expect(Number.parseInt(String(limited.headers['retry-after']), 10)).toBeGreaterThan(0);
    await attempt(PASSWORD).expect(429); // even the right password waits
    // another app instance has its own counter; 0 = off
    const off = serverApp({ loginLimit: 0 });
    for (let i = 0; i < 4; i++) await request(off).post('/api/v1/auth/login').send({ login: user, password: 'wrong' }).expect(401);
  });

  it('the limit per address (AUTH_IP_LIMIT=2): failures of any logins from one address', async () => {
    const app = serverApp({ ipLimit: 2 });
    await request(app).post('/api/v1/auth/login').send({ login: `x1-${suffix}`, password: 'wrong' }).expect(401);
    await request(app).post('/api/v1/auth/login').send({ login: `x2-${suffix}`, password: 'wrong' }).expect(401);
    await request(app).post('/api/v1/auth/login').send({ login: `x3-${suffix}`, password: 'wrong' }).expect(429);
  });

  it('the limit holds against parallel attempts: 10 wrong at once with limit 2 give at most 2 × 401, the rest 429', async () => {
    const app = serverApp({ loginLimit: 2 });
    const user = `auth-p-${suffix}`;
    await auth.createUser({ login: user, password: PASSWORD, orgId: orgA, createdBy: 'tests' });
    const answers = await Promise.all(
      Array.from({ length: 10 }, () => request(app).post('/api/v1/auth/login').send({ login: user, password: 'wrong' })),
    );
    const statuses = answers.map((a) => a.status);
    expect(statuses.filter((s) => s === 401).length).toBeLessThanOrEqual(2);
    expect(statuses.filter((s) => s !== 401 && s !== 429)).toEqual([]);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(8);
  });

  it('TRUST_PROXY=1 / true is one hop: req.ip is the address the last proxy saw', async () => {
    expect(authConfigFromEnv({ AUTH_MODE: 'off', TRUST_PROXY: 'true' }).trustProxy).toBe(1);
    expect(authConfigFromEnv({ AUTH_MODE: 'off', TRUST_PROXY: '1' }).trustProxy).toBe(1);
    expect(authConfigFromEnv({ AUTH_MODE: 'off', TRUST_PROXY: '0' }).trustProxy).toBeUndefined();
    // the limit per address shows which address counts: the last entry of X-Forwarded-For
    const app = serverApp({ ipLimit: 1, trustProxy: 1 });
    const attempt = (xff: string, n: number) =>
      request(app).post('/api/v1/auth/login').set('X-Forwarded-For', xff).send({ login: `xff${n}-${suffix}`, password: 'wrong' });
    await attempt('203.0.113.9, 198.51.100.7', 1).expect(401);
    await attempt('203.0.113.10, 198.51.100.7', 2).expect(429); // a forged first entry does not help
    await attempt('198.51.100.7, 198.51.100.8', 3).expect(401); // another last hop is another address
  });

  it('a login racing a password reset: the session is not opened (401), no session row', async () => {
    const login = `auth-race-${suffix}`;
    await auth.createUser({ login, password: PASSWORD, orgId: orgA, createdBy: 'tests' });
    const result = await auth.login(login, PASSWORD);
    if (result.kind !== 'ok') throw new Error('expected a signed-in result');
    await auth.resetPassword(login, 'reset-meanwhile');
    await expect(auth.openSession(result.user, new Date(Date.now() + 60_000).toISOString(), result.verifiedHash)).rejects.toMatchObject({
      statusCode: 401,
      code: 'invalid_credentials',
    });
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM auth.sessions WHERE user_id = $1', [result.user.id]);
    expect(rows[0].n).toBe(0);
    // disabled between the check and the session: the same
    const again = await auth.login(login, 'reset-meanwhile');
    if (again.kind !== 'ok') throw new Error('expected a signed-in result');
    await auth.setDisabled(login, true);
    await expect(auth.openSession(again.user, new Date(Date.now() + 60_000).toISOString(), again.verifiedHash)).rejects.toMatchObject({
      code: 'invalid_credentials',
    });
  });

  it('the rehash never writes over a password changed meanwhile', async () => {
    const login = `auth-rr-${suffix}`;
    await auth.createUser({ login, password: PASSWORD, orgId: orgA, createdBy: 'tests' });
    const salt = randomBytes(16);
    const old = `scrypt$16384$8$1$${salt.toString('base64')}$${scryptSync(PASSWORD, salt, 64, { N: 16384, r: 8, p: 1 }).toString('base64')}`;
    await pool.query('UPDATE auth.users SET password_hash = $1 WHERE login = $2', [old, login]);
    // a reset lands while the login verifies the old hash: the conditional rehash leaves the reset in place
    const pending = auth.login(login, PASSWORD);
    await auth.resetPassword(login, 'the-new-one');
    const result = await pending;
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok')
      await expect(auth.openSession(result.user, new Date(Date.now() + 60_000).toISOString(), result.verifiedHash)).rejects.toMatchObject({
        code: 'invalid_credentials',
      });
    const fresh = await auth.login(login, 'the-new-one');
    expect(fresh.kind).toBe('ok');
  });

  it('Origin: a write from another site is 403 csrf; the same origin (the Vite proxy) or none passes', async () => {
    const app = serverApp();
    const body = { login: MULTI, password: PASSWORD, orgId: orgA };
    const login = () => request(app).post('/api/v1/auth/login');
    const evil = await login().set('Origin', 'https://evil.example').send(body);
    expect([evil.status, evil.body.error?.code]).toEqual([403, 'csrf']);
    const cross = await login().set('Sec-Fetch-Site', 'cross-site').send(body);
    expect([cross.status, cross.body.error?.code]).toEqual([403, 'csrf']);
    // the Vite proxy (no changeOrigin) forwards Host: localhost:5173 and the browser's Origin http://localhost:5173
    const vite = await login()
      .set('Host', 'localhost:5173')
      .set('Origin', 'http://localhost:5173')
      .set('Sec-Fetch-Site', 'same-origin')
      .send(body)
      .expect(200);
    const cookie = pair(cookieOf(vite));
    const write = () => request(app).post('/api/v1/owners').set('Cookie', cookie).set('X-Operator', 'x');
    const refused = await write().set('Origin', 'http://localhost:5174').send({ name: 'Csrf Synthetic', kind: 'person' });
    expect([refused.status, refused.body.error?.code]).toEqual([403, 'csrf']);
    await write().send({ name: 'Csrf Synthetic', kind: 'person' }).expect(201); // no Origin: scripts, supertest
    // reads are not checked; APP_ORIGIN adds an origin
    await request(app).get('/api/v1/auth/me').set('Cookie', cookie).set('Origin', 'https://evil.example').expect(200);
    await request(serverApp({ appOrigins: ['https://erp.example'] })).post('/api/v1/auth/logout').set('Origin', 'https://erp.example').expect(200);
    // the login takes JSON only
    const form = await login().type('form').send(`login=${MULTI}&password=${PASSWORD}`);
    expect([form.status, form.body.error?.code]).toEqual([400, 'validation_error']);
  });
});
