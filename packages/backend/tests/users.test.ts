import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createServerApp } from '../src/api/server-app';
import { createAuthService } from '../src/auth/service';
import { createOrgFacades } from '../src/orgs/facades';
import { createOrgsService } from '../src/orgs/service';
import { newFacade, TMP } from './helpers/fixtures';
import { testStack } from './helpers/test-sources';

// The users of an organization (D-171, stage 3 commit 4): its org_admin manages the members of its own organization
// (`/users*`); the system administrator adds existing users, changes memberships (`/orgs/:id/members`,
// `/orgs/:id/users/:userId`) and manages every user (`/system/users*`). Synthetic logins and data only.

const SECRET = randomBytes(32).toString('hex');
const PASSWORD = randomBytes(12).toString('hex');
const suffix = randomUUID().slice(0, 8);
const ADMIN_A = `users-a-${suffix}`;
const ADMIN_B = `users-b-${suffix}`;
const SYS = `users-sys-${suffix}`;

type Res = { status: number; body: { error?: { code?: string } } & Record<string, unknown> };
const answer = (res: Res) => `${res.status} ${res.body.error?.code ?? ''}`.trim();

describe('the users of an organization (D-171)', () => {
  let app: Express;
  let orgA = '';
  let orgB = '';
  let orgs: ReturnType<typeof createOrgFacades>;
  let auth: ReturnType<typeof createAuthService>;
  const cookie = { a: '', b: '', sys: '' };
  let zero = '';
  let echo = '';
  let sub = '';
  let labelB = '';

  const signIn = async (login: string, password = PASSWORD, orgId?: string) => {
    const res = await request(app).post('/api/v1/auth/login').send({ login, password, ...(orgId ? { orgId } : {}) }).expect(200);
    return (((res.headers['set-cookie'] as unknown as string[])[0] as string).split(';')[0]) as string;
  };
  const as = (c: string, method: 'get' | 'post' | 'patch', url: string, body?: object) => {
    const t = request(app)[method]('/api/v1' + url).set('Cookie', c);
    return method === 'get' ? t : t.set('X-Operator', 'users-test').send(body ?? {});
  };
  const meStatus = async (c: string) => (await request(app).get('/api/v1/auth/me').set('Cookie', c)).status;

  beforeAll(async () => {
    const f = await newFacade();
    orgA = f.orgId;
    const stack = await testStack();
    await stack.reset();
    const dataDir = join(TMP, `users-${suffix}`);
    mkdirSync(dataDir, { recursive: true });
    orgs = createOrgFacades({ stores: { db: stack.db, pool: stack.pg.pool, columnar: stack.columnar }, dataDir, payoutThresholdCents: 0 });
    auth = createAuthService(stack.db);
    orgB = (await createOrgsService(stack.db).createOrganization({ name: `Users B ${suffix}`, createdBy: 'tests' })).id;
    await auth.createUser({ login: ADMIN_A, password: PASSWORD, orgId: orgA, role: 'org_admin', createdBy: 'tests' });
    await auth.createUser({ login: ADMIN_B, password: PASSWORD, orgId: orgB, role: 'org_admin', createdBy: 'tests' });
    await auth.createUser({ login: SYS, password: PASSWORD, system: true, createdBy: 'tests' });
    app = createServerApp({ orgs, auth: { service: auth, config: { mode: 'on', secret: SECRET } } });
    cookie.a = await signIn(ADMIN_A);
    cookie.b = await signIn(ADMIN_B);
    cookie.sys = await signIn(SYS);
    const labels = (await as(cookie.a, 'get', '/labels').expect(200)).body as { id: string; name: string }[];
    zero = labels.find((l) => l.name === '0to8')?.id as string;
    echo = labels.find((l) => l.name === 'Echo8')?.id as string;
    sub = ((await as(cookie.a, 'post', '/labels', { name: `Users Sub ${suffix}`, kind: 'sublabel', ownLabelId: zero }).expect(201)).body as { id: string }).id;
    labelB = ((await as(cookie.b, 'post', '/labels', { name: `Users B Own ${suffix}`, kind: 'own' }).expect(201)).body as { id: string }).id;
  });

  it('org_admin creates a manager with own labels; a sublabel, a label of B, none and a taken login are refused', async () => {
    const login = `users-m1-${suffix}`;
    const body = (labelIds: string[], l = login) => ({ login: l.toUpperCase(), password: PASSWORD, role: 'label_manager', labelIds });
    expect(answer(await as(cookie.a, 'post', '/users', body([sub])))).toBe('400 label_not_own');
    expect(answer(await as(cookie.a, 'post', '/users', body([labelB])))).toBe('404 not_found');
    expect(answer(await as(cookie.a, 'post', '/users', body([])))).toBe('400 validation_error');
    expect(answer(await as(cookie.a, 'post', '/users', { ...body([]), role: 'org_admin', labelIds: [zero] }))).toBe('400 validation_error');
    const created = await as(cookie.a, 'post', '/users', body([zero])).expect(201);
    expect(created.body).toMatchObject({ login, role: 'label_manager', labelIds: [zero], active: true, disabled: false, createdBy: ADMIN_A });
    expect(answer(await as(cookie.a, 'post', '/users', body([zero])))).toBe('409 login_taken');
    expect(answer(await as(cookie.b, 'post', '/users', body([labelB], login)))).toBe('409 login_taken'); // logins are global
    // the list: the members of A only, never a hash
    const list = (await as(cookie.a, 'get', '/users').expect(200)).body as { login: string }[];
    expect(list.map((u) => u.login)).toEqual(expect.arrayContaining([ADMIN_A, login]));
    expect(list.map((u) => u.login)).not.toContain(ADMIN_B);
    expect(JSON.stringify(list)).not.toMatch(/scrypt|passwordHash/);
    // the audit of A: the operator and the role, never the login or the password
    const [row] = await (await orgs.get(orgA)).facade.recentActions(1);
    expect(row).toMatchObject({ operator: ADMIN_A, method: 'POST', route: '/users', entityIds: [created.body.id], summary: { params: {}, body: { role: 'label_manager' } } });
    expect(JSON.stringify(row)).not.toContain(login);
    expect(JSON.stringify(row)).not.toContain(PASSWORD);
    // the manager signs in with the label
    const m = await signIn(login);
    const me = (await request(app).get('/api/v1/auth/me').set('Cookie', m).expect(200)).body as { role: string; labels: { id: string }[] };
    expect([me.role, me.labels.map((l) => l.id)]).toEqual(['label_manager', [zero]]);
  });

  it('a manager and the system administrator without a grant are refused /users', async () => {
    const login = `users-m2-${suffix}`;
    await as(cookie.a, 'post', '/users', { login, password: PASSWORD, role: 'label_manager', labelIds: [zero] }).expect(201);
    const m = await signIn(login);
    expect(answer(await as(m, 'get', '/users'))).toBe('403 forbidden');
    expect(answer(await as(m, 'post', '/users', { login: `users-x-${suffix}`, password: PASSWORD, role: 'org_admin' }))).toBe('403 forbidden');
    expect(answer(await as(cookie.sys, 'get', '/users').set('X-Org', orgA))).toBe('403 support_required');
  });

  it('PATCH: the role and the labels act at the next request; last_org_admin; suspending ends the sessions here', async () => {
    const login = `users-m3-${suffix}`;
    const id = ((await as(cookie.a, 'post', '/users', { login, password: PASSWORD, role: 'label_manager', labelIds: [zero] }).expect(201)).body as { id: string }).id;
    const m = await signIn(login);
    // A has one administrator: it is neither demoted nor suspended
    const adminId = ((await as(cookie.a, 'get', '/users').expect(200)).body as { id: string; login: string }[]).find((u) => u.login === ADMIN_A)?.id as string;
    expect(answer(await as(cookie.a, 'patch', `/users/${adminId}`, { role: 'label_manager', labelIds: [zero] }))).toBe('409 last_org_admin');
    expect(answer(await as(cookie.a, 'patch', `/users/${adminId}`, { active: false }))).toBe('409 last_org_admin');
    // labels replaced, a sublabel refused, nothing to change refused
    expect(answer(await as(cookie.a, 'patch', `/users/${id}`, { labelIds: [sub] }))).toBe('400 label_not_own');
    expect(answer(await as(cookie.a, 'patch', `/users/${id}`, {}))).toBe('400 validation_error');
    const relabelled = await as(cookie.a, 'patch', `/users/${id}`, { labelIds: [echo] }).expect(200);
    expect(relabelled.body).toMatchObject({ role: 'label_manager', labelIds: [echo] });
    expect(((await request(app).get('/api/v1/auth/me').set('Cookie', m).expect(200)).body as { labels: { id: string }[] }).labels.map((l) => l.id)).toEqual([echo]);
    // the role acts at once: the manager becomes an administrator (labels dropped), then A's first one may step down
    expect(answer(await as(m, 'get', '/users'))).toBe('403 forbidden');
    expect((await as(cookie.a, 'patch', `/users/${id}`, { role: 'org_admin' }).expect(200)).body).toMatchObject({ role: 'org_admin', labelIds: [] });
    expect(answer(await as(m, 'get', '/users'))).toBe('200');
    const [row] = await (await orgs.get(orgA)).facade.recentActions(1);
    expect(row).toMatchObject({ operator: ADMIN_A, method: 'PATCH', route: '/users/:id', entityIds: [id], summary: { body: { role: 'org_admin' } } });
    await as(m, 'patch', `/users/${id}`, { role: 'label_manager', labelIds: [zero] }).expect(200); // now not the last one
    await as(cookie.a, 'patch', `/users/${id}`, { active: false }).expect(200);
    expect(await meStatus(m)).toBe(401);
    await request(app).post('/api/v1/auth/login').send({ login, password: PASSWORD }).expect(403); // no active membership
    await as(cookie.a, 'patch', `/users/${id}`, { active: true }).expect(200);
    await signIn(login);
    // a user of B is not a member of A: 404
    const bAdmin = ((await as(cookie.b, 'get', '/users').expect(200)).body as { id: string }[])[0]?.id as string;
    expect(answer(await as(cookie.a, 'patch', `/users/${bAdmin}`, { active: false }))).toBe('404 not_found');
    expect(answer(await as(cookie.a, 'patch', `/users/${randomUUID()}`, { active: false }))).toBe('404 not_found');
  });

  it('a password set by the administrator ends every session; a member of another organization is 403', async () => {
    const login = `users-p-${suffix}`;
    const id = ((await as(cookie.a, 'post', '/users', { login, password: PASSWORD, role: 'label_manager', labelIds: [zero] }).expect(201)).body as { id: string }).id;
    const before = await signIn(login);
    await as(cookie.a, 'post', `/users/${id}/password`, { password: 'reset-by-admin' }).expect(200);
    expect(await meStatus(before)).toBe(401);
    await signIn(login, 'reset-by-admin');
    const [row] = await (await orgs.get(orgA)).facade.recentActions(1);
    expect(row).toMatchObject({ route: '/users/:id/password', entityIds: [id], summary: { body: {} } });
    expect(JSON.stringify(row)).not.toContain('reset-by-admin');
    // also a member of B: only the system administrator resets it
    await auth.addMembership({ login, orgId: orgB, role: 'label_manager', labelIds: [labelB], createdBy: 'tests' });
    expect(answer(await as(cookie.a, 'post', `/users/${id}/password`, { password: 'another' }))).toBe('403 forbidden');
    expect(answer(await as(cookie.a, 'post', `/users/${randomUUID()}/password`, { password: 'another' }))).toBe('404 not_found');
  });

  it('system: add an existing user, change a membership, every user, disable and reset (no audit row outside an organization)', async () => {
    const login = `users-s-${suffix}`;
    const id = ((await as(cookie.a, 'post', '/users', { login, password: PASSWORD, role: 'label_manager', labelIds: [zero] }).expect(201)).body as { id: string }).id;
    const added = await as(cookie.sys, 'post', `/orgs/${orgB}/members`, { login: login.toUpperCase(), role: 'label_manager', labelIds: [labelB] }).expect(201);
    expect(added.body).toMatchObject({ id, login, role: 'label_manager', labelIds: [labelB] });
    expect(answer(await as(cookie.sys, 'post', `/orgs/${orgB}/members`, { login, role: 'org_admin' }))).toBe('409 already_member');
    expect(answer(await as(cookie.sys, 'post', `/orgs/${orgB}/members`, { login: SYS, role: 'org_admin' }))).toBe('400 validation_error');
    expect(answer(await as(cookie.sys, 'post', `/orgs/${orgB}/members`, { login: `nobody-${suffix}`, role: 'org_admin' }))).toBe('404 not_found');
    expect(answer(await as(cookie.sys, 'post', `/orgs/${orgB}/members`, { login: ADMIN_A, role: 'label_manager', labelIds: [zero] }))).toBe('404 not_found');
    expect(answer(await as(cookie.a, 'post', `/orgs/${orgB}/members`, { login: ADMIN_A, role: 'org_admin' }))).toBe('403 forbidden');
    const [rowB] = await (await orgs.get(orgB)).facade.recentActions(1);
    expect(rowB).toMatchObject({ operator: SYS, route: '/orgs/:id/members', entityIds: [orgB, id], summary: { body: { role: 'label_manager' } } });
    expect(JSON.stringify(rowB)).not.toContain(login);
    // a membership changed by the system administrator
    const changed = await as(cookie.sys, 'patch', `/orgs/${orgB}/users/${id}`, { role: 'org_admin' }).expect(200);
    expect(changed.body).toMatchObject({ role: 'org_admin', labelIds: [] });
    expect(answer(await as(cookie.sys, 'patch', `/orgs/${orgB}/users/${randomUUID()}`, { active: false }))).toBe('404 not_found');
    // every user with the memberships
    const all = (await as(cookie.sys, 'get', '/system/users').expect(200)).body as { id: string; login: string; isSystemAdmin: boolean; memberships: { orgId: string; role: string }[] }[];
    expect(all.find((u) => u.id === id)?.memberships.map((m) => [m.orgId, m.role]).sort()).toEqual(
      [[orgA, 'label_manager'], [orgB, 'org_admin']].sort(),
    );
    expect(all.find((u) => u.login === SYS)).toMatchObject({ isSystemAdmin: true, memberships: [] });
    expect(JSON.stringify(all)).not.toMatch(/scrypt|passwordHash/);
    expect(answer(await as(cookie.a, 'get', '/system/users'))).toBe('403 forbidden');
    // disable ends every session; enable; a reset ends them too
    const session = await signIn(login, PASSWORD, orgA);
    const disabled = await as(cookie.sys, 'patch', `/system/users/${id}`, { disabled: true }).expect(200);
    expect(disabled.body).toMatchObject({ id, disabled: true });
    expect(await meStatus(session)).toBe(401);
    await request(app).post('/api/v1/auth/login').send({ login, password: PASSWORD, orgId: orgA }).expect(401);
    await as(cookie.sys, 'patch', `/system/users/${id}`, { disabled: false }).expect(200);
    const again = await signIn(login, PASSWORD, orgA);
    await as(cookie.sys, 'post', `/system/users/${id}/password`, { password: 'reset-by-system' }).expect(200);
    expect(await meStatus(again)).toBe(401);
    await signIn(login, 'reset-by-system', orgA);
    expect(answer(await as(cookie.sys, 'patch', `/system/users/${randomUUID()}`, { disabled: true }))).toBe('404 not_found');
    // outside an organization: no audit row in A or B
    for (const org of [orgA, orgB]) {
      const rows = await (await orgs.get(org)).facade.recentActions(50);
      expect(rows.filter((r) => r.route.startsWith('/system/users'))).toEqual([]);
    }
    // X-Operator is still required
    expect(answer(await request(app).patch(`/api/v1/system/users/${id}`).set('Cookie', cookie.sys).send({ disabled: false }))).toBe('400 operator_required');
  });
});
