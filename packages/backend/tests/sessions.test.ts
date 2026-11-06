import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createServerApp } from '../src/api/server-app';
import { createAuthService } from '../src/auth/service';
import { nowSeconds } from '../src/auth/token';
import { createOrgFacades } from '../src/orgs/facades';
import { createOrgsService } from '../src/orgs/service';
import { newFacade, TMP } from './helpers/fixtures';
import { testStack } from './helpers/test-sources';

// Revocable sessions (D-171): the token carries { sub, sid }, the row of auth.sessions is read on every request.
// Logout, the own password change, disabling a user and suspending a membership end sessions at once; a stage-2 token
// without sid and an expired row are 401. Synthetic data only.

const SECRET = randomBytes(32).toString('hex');
const PASSWORD = randomBytes(12).toString('hex');
const suffix = randomUUID().slice(0, 8);
const pair = (res: { headers: Record<string, unknown> }) =>
  (((res.headers['set-cookie'] as string[] | undefined) ?? []).find((c) => c.startsWith('erp_session=')) ?? '').split(';')[0] as string;

describe('sessions (D-171)', () => {
  let app: Express;
  let orgA = '';
  let orgB = '';
  let auth: ReturnType<typeof createAuthService>;
  let orgs: ReturnType<typeof createOrgFacades>;
  let pool: Awaited<ReturnType<typeof testStack>>['pg']['pool'];

  const signIn = async (login: string, password = PASSWORD, orgId?: string) =>
    pair(await request(app).post('/api/v1/auth/login').send({ login, password, ...(orgId ? { orgId } : {}) }).expect(200));
  const meStatus = async (cookie: string) => (await request(app).get('/api/v1/auth/me').set('Cookie', cookie)).status;
  const newUser = async (tag: string) => {
    const login = `sess-${tag}-${suffix}`;
    await auth.createUser({ login, password: PASSWORD, orgId: orgA, createdBy: 'tests' });
    return login;
  };

  beforeAll(async () => {
    const f = await newFacade();
    orgA = f.orgId;
    const stack = await testStack();
    await stack.reset();
    pool = stack.pg.pool;
    const dataDir = join(TMP, `sessions-${suffix}`);
    mkdirSync(dataDir, { recursive: true });
    orgs = createOrgFacades({ stores: { db: stack.db, pool: stack.pg.pool, columnar: stack.columnar }, dataDir, payoutThresholdCents: 0 });
    auth = createAuthService(stack.db);
    orgB = (await createOrgsService(stack.db).createOrganization({ name: `Sessions B ${suffix}`, createdBy: 'tests' })).id;
    app = createServerApp({ orgs, auth: { service: auth, config: { mode: 'on', secret: SECRET } } });
  });

  it('logout revokes the session: the same cookie is 401 afterwards, another session lives', async () => {
    const login = await newUser('out');
    const one = await signIn(login);
    const two = await signIn(login);
    expect(one).not.toBe(two);
    await request(app).post('/api/v1/auth/logout').set('Cookie', one).expect(200);
    expect(await meStatus(one)).toBe(401);
    expect(await meStatus(two)).toBe(200);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM auth.sessions s JOIN auth.users u ON u.id = s.user_id WHERE u.login = $1 AND s.revoked_at IS NOT NULL', [login]);
    expect(rows[0].n).toBe(1);
  });

  it('the own password: a wrong current one is 401; the change ends the other sessions, the current lives', async () => {
    const login = await newUser('pw');
    const current = await signIn(login);
    const other = await signIn(login);
    const change = (cookie: string, body: object) =>
      request(app).post('/api/v1/auth/password').set('Cookie', cookie).set('X-Operator', 'x').send(body);
    const wrong = await change(current, { current: 'not it', next: 'new-one' });
    expect([wrong.status, wrong.body.error?.code]).toEqual([401, 'invalid_credentials']);
    expect(await meStatus(other)).toBe(200);
    await change(current, { current: PASSWORD, next: 'new-one' }).expect(200);
    expect(await meStatus(other)).toBe(401);
    expect(await meStatus(current)).toBe(200);
    await request(app).post('/api/v1/auth/login').send({ login, password: PASSWORD }).expect(401);
    await signIn(login, 'new-one');
    // a member's change is in the audit of the session's organization, without values
    const [row] = await (await orgs.get(orgA)).facade.recentActions(1);
    expect(row).toMatchObject({ operator: login, method: 'POST', route: '/auth/password' });
    expect(JSON.stringify(row)).not.toContain('new-one');
    // without a session: 401
    await request(app).post('/api/v1/auth/password').set('X-Operator', 'x').send({ current: 'a', next: 'b' }).expect(401);
  });

  it('disabling a user ends every session; a reset password too', async () => {
    const login = await newUser('dis');
    const cookie = await signIn(login);
    await auth.setDisabled(login, true);
    expect(await meStatus(cookie)).toBe(401);
    await auth.setDisabled(login, false);
    expect(await meStatus(cookie)).toBe(401); // revoked, not only refused while disabled
    const again = await signIn(login);
    await auth.resetPassword(login, 'reset-one');
    expect(await meStatus(again)).toBe(401);
  });

  it('a suspended membership ends the sessions of that organization; the other organization lives', async () => {
    const login = await newUser('susp');
    await auth.addMembership({ login, orgId: orgB, role: 'org_admin', labelIds: [], createdBy: 'tests' });
    const inA = await signIn(login, PASSWORD, orgA);
    const inB = await signIn(login, PASSWORD, orgB);
    await pool.query(
      'UPDATE auth.memberships SET disabled_at = now() WHERE org_id = $1 AND user_id = (SELECT id FROM auth.users WHERE login = $2)',
      [orgA, login],
    );
    expect(await meStatus(inA)).toBe(401);
    expect(await meStatus(inB)).toBe(200);
    // one active membership left: the login goes there directly
    const direct = await request(app).post('/api/v1/auth/login').send({ login, password: PASSWORD }).expect(200);
    expect(direct.body.org.id).toBe(orgB);
  });

  it('a stage-2 token without sid and an expired session row are 401', async () => {
    const login = await newUser('old');
    const cookie = await signIn(login);
    const { rows } = await pool.query<{ id: string }>('SELECT id FROM auth.users WHERE login = $1', [login]);
    const userId = rows[0]?.id as string;
    const now = nowSeconds();
    const head = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ sub: userId, iat: now, exp: now + 3600 })).toString('base64url');
    const old = `${head}.${body}.${createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url')}`;
    expect(await meStatus(`erp_session=${old}`)).toBe(401);
    expect(await meStatus(cookie)).toBe(200);
    await pool.query(
      "UPDATE auth.sessions SET issued_at = now() - interval '2 days', expires_at = now() - interval '1 day' WHERE user_id = $1",
      [userId],
    );
    expect(await meStatus(cookie)).toBe(401);
  });

  it('the token of one user does not open the session row of another', async () => {
    const a = await newUser('xa');
    const b = await newUser('xb');
    const cookieA = await signIn(a);
    await signIn(b);
    const { rows } = await pool.query<{ id: string; user_id: string }>(
      'SELECT s.id, s.user_id FROM auth.sessions s JOIN auth.users u ON u.id = s.user_id WHERE u.login = $1 AND s.revoked_at IS NULL',
      [b],
    );
    const [, payload] = cookieA.slice('erp_session='.length).split('.') as [string, string];
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { sub: string; iat: number; exp: number };
    const head = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const mixed = Buffer.from(JSON.stringify({ ...claims, sid: rows[0]?.id })).toString('base64url');
    const token = `${head}.${mixed}.${createHmac('sha256', SECRET).update(`${head}.${mixed}`).digest('base64url')}`;
    expect(await meStatus(`erp_session=${token}`)).toBe(401);
  });
});
