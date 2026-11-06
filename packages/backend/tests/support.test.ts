import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createServerApp } from '../src/api/server-app';
import { API_OPERATIONS, isOrgOperation, operationKey } from '../src/api/operations';
import { createAuthService } from '../src/auth/service';
import { createOrgFacades } from '../src/orgs/facades';
import { newFacade, TMP } from './helpers/fixtures';
import { testStack } from './helpers/test-sources';

// The support access (D-171, stage 3 commit 4): the system administrator works in an organization only under a live
// grant of its org_admin (read and read money; write with a write grant; never approve, pay or admin); without one
// 403 support_required, after its end 403 support_expired; the system key never works in an organization. Every
// write under a grant is marked in the organization's audit (`summary.support = true`). Synthetic data only.

const SECRET = randomBytes(32).toString('hex');
const SYSTEM_KEY = randomBytes(24).toString('hex');
const PASSWORD = randomBytes(12).toString('hex');
const suffix = randomUUID().slice(0, 8);
const ADMIN = `support-a-${suffix}`;
const MEMBER = `support-m-${suffix}`;
const SYS = `support-sys-${suffix}`;

type Res = { status: number; body: { error?: { code?: string } } & Record<string, unknown> };
const answer = (res: Res) => `${res.status} ${res.body.error?.code ?? ''}`.trim();
const inHours = (h: number) => new Date(Date.now() + h * 3600 * 1000).toISOString();

describe('support grants (D-171)', () => {
  let app: Express;
  let orgA = '';
  let orgs: ReturnType<typeof createOrgFacades>;
  let pool: Awaited<ReturnType<typeof testStack>>['pg']['pool'];
  const cookie = { a: '', b: '', sys: '' };

  const signIn = async (login: string) => {
    const res = await request(app).post('/api/v1/auth/login').send({ login, password: PASSWORD }).expect(200);
    return (((res.headers['set-cookie'] as unknown as string[])[0] as string).split(';')[0]) as string;
  };
  const admin = (method: 'get' | 'post', url: string, body?: object) => {
    const t = request(app)[method]('/api/v1' + url).set('Cookie', cookie.a as string);
    return method === 'get' ? t : t.set('X-Operator', 'support-test').send(body ?? {});
  };
  /** The system administrator in organization A (X-Org). */
  const sys = (method: 'get' | 'post' | 'patch', url: string, body?: object) => {
    const t = request(app)[method]('/api/v1' + url).set('Cookie', cookie.sys as string).set('X-Org', orgA);
    return method === 'get' ? t : t.set('X-Operator', 'support-test').send(body ?? {});
  };
  const enter = () => request(app).post(`/api/v1/orgs/${orgA}/support/enter`).set('Cookie', cookie.sys as string).set('X-Operator', 'x');
  const grant = async (body: object) => (await admin('post', '/support', { login: SYS, ...body }).expect(201)).body as { id: string; write: boolean; expiresAt: string; active: boolean };
  const revokeAll = async () => {
    for (const g of (await admin('get', '/support').expect(200)).body as { id: string; active: boolean }[])
      if (g.active) await admin('post', `/support/${g.id}/revoke`).expect(200);
  };
  const url = (path: string) => path.replace(/:([A-Za-z]+)/g, 'support-missing');
  const latestRow = async () => (await (await orgs.get(orgA)).facade.recentActions(1))[0];

  beforeAll(async () => {
    const f = await newFacade();
    orgA = f.orgId;
    const stack = await testStack();
    await stack.reset();
    pool = stack.pg.pool;
    const dataDir = join(TMP, `support-${suffix}`);
    mkdirSync(dataDir, { recursive: true });
    orgs = createOrgFacades({ stores: { db: stack.db, pool: stack.pg.pool, columnar: stack.columnar }, dataDir, payoutThresholdCents: 0 });
    const auth = createAuthService(stack.db);
    await auth.createUser({ login: ADMIN, password: PASSWORD, orgId: orgA, role: 'org_admin', createdBy: 'tests' });
    await auth.createUser({ login: MEMBER, password: PASSWORD, orgId: orgA, role: 'org_admin', createdBy: 'tests' });
    await auth.createUser({ login: SYS, password: PASSWORD, system: true, createdBy: 'tests' });
    app = createServerApp({ orgs, auth: { service: auth, config: { mode: 'on', secret: SECRET, systemKey: SYSTEM_KEY } } });
    cookie.a = await signIn(ADMIN);
    cookie.sys = await signIn(SYS);
  });

  it('without a grant: every operation of the organization is 403 support_required; the system key too', async () => {
    for (const o of API_OPERATIONS.filter(isOrgOperation)) {
      const res = await sys(o.method, url(o.path), {});
      expect(answer(res), operationKey(o)).toBe('403 support_required');
    }
    const key = await request(app).get('/api/v1/owners').set('X-System-Key', SYSTEM_KEY).set('X-Org', orgA);
    expect(answer(key)).toBe('403 support_required');
    expect(answer(await request(app).get('/api/v1/owners').set('X-System-Key', SYSTEM_KEY))).toBe('403 support_required');
    expect(answer(await enter())).toBe('403 support_required');
    expect(answer(await request(app).post(`/api/v1/orgs/${orgA}/support/enter`).set('X-System-Key', SYSTEM_KEY).set('X-Operator', 'x'))).toBe(
      '403 support_required',
    );
    const list = (await request(app).get('/api/v1/orgs').set('Cookie', cookie.sys as string).expect(200)).body as { id: string; support: unknown }[];
    expect(list.find((o) => o.id === orgA)?.support).toBeNull();
    // a member sends no X-Org; an unknown organization is still 404
    expect(answer(await request(app).get('/api/v1/owners').set('Cookie', cookie.sys as string).set('X-Org', randomUUID()))).toBe('404 org_not_found');
  });

  it('the grant is validated: a login that is not a system administrator is 404, the end in the future and at most 7 days', async () => {
    expect(answer(await admin('post', '/support', { login: MEMBER }))).toBe('404 not_found');
    expect(answer(await admin('post', '/support', { login: `nobody-${suffix}` }))).toBe('404 not_found');
    expect(answer(await admin('post', '/support', { login: SYS, expiresAt: inHours(-1) }))).toBe('400 validation_error');
    expect(answer(await admin('post', '/support', { login: SYS, expiresAt: inHours(7 * 24 + 1) }))).toBe('400 validation_error');
    expect(answer(await admin('post', '/support', { login: SYS, expiresAt: 'tomorrow' }))).toBe('400 validation_error');
    // the default is 24 hours, read only
    const g = await grant({});
    expect(g).toMatchObject({ write: false, active: true });
    expect(Math.abs(new Date(g.expiresAt).getTime() - Date.now() - 24 * 3600 * 1000)).toBeLessThan(60_000);
    await revokeAll();
  });

  it('a read grant: enter, every read 200 with money, a write 403 support_read_only, approve / pay / admin 403 forbidden', async () => {
    const g = await grant({ expiresAt: inHours(1) });
    const granted = await latestRow();
    expect(granted).toMatchObject({ operator: ADMIN, method: 'POST', route: '/support', entityIds: [g.id], summary: { body: { expiresAt: expect.any(String) } } });
    expect(JSON.stringify(granted)).not.toContain(SYS);
    const me = (await enter().expect(200)).body as Record<string, unknown>;
    expect(me).toMatchObject({ role: 'support', org: { id: orgA }, allLabels: true, support: { orgId: orgA, write: false }, memberships: [] });
    expect(me.abilities).toEqual(expect.arrayContaining(['GET /overview', 'GET /orgs', 'GET /owners/payables']));
    for (const closed of ['POST /owners', 'POST /owners/merge', 'GET /users']) expect(me.abilities).not.toContain(closed);
    const entered = await latestRow();
    expect(entered).toMatchObject({ operator: SYS, route: '/orgs/:id/support/enter', entityIds: [orgA], summary: { support: true } });
    const viaMe = (await request(app).get('/api/v1/auth/me').set('Cookie', cookie.sys as string).set('X-Org', orgA).expect(200)).body;
    expect(viaMe).toMatchObject({ role: 'support', support: { orgId: orgA, write: false } });
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', cookie.sys as string).expect(200)).body).toMatchObject({ role: 'system', support: null });
    const list = (await request(app).get('/api/v1/orgs').set('Cookie', cookie.sys as string).expect(200)).body as { id: string; support: unknown }[];
    expect(list.find((o) => o.id === orgA)?.support).toEqual({ expiresAt: g.expiresAt, write: false });

    for (const o of API_OPERATIONS.filter(isOrgOperation)) {
      const key = operationKey(o);
      const res = answer(await sys(o.method, url(o.path), {}));
      if (o.ability.action === 'read' || o.ability.action === 'read_money') expect(res, key).not.toMatch(/^403/);
      else if (o.ability.action === 'write') expect(res, key).toBe('403 support_read_only');
      else expect(res, key).toBe('403 forbidden');
    }
    expect(answer(await sys('get', '/overview'))).toBe('200');
    expect(answer(await sys('get', '/owners/payables'))).toBe('200');
    await revokeAll();
  });

  it('a write grant: a write passes and is marked support in the audit; approve stays 403', async () => {
    await grant({ expiresAt: inHours(2), write: true });
    expect((await enter().expect(200)).body).toMatchObject({ support: { write: true } });
    const owner = (await sys('post', '/owners', { name: 'Support Synthetic', kind: 'person' }).expect(201)).body as { id: string };
    const row = await latestRow();
    expect(row).toMatchObject({ operator: SYS, method: 'POST', route: '/owners', entityIds: [owner.id], summary: { support: true } });
    expect(answer(await sys('post', '/owners/merge', { fromId: owner.id, intoId: owner.id, reason: 'x' }))).toBe('403 forbidden');
    expect(answer(await sys('post', '/support', { login: SYS }))).toBe('403 forbidden');
    // an administrator's own write is not marked
    await admin('post', '/owners', { name: 'Admin Synthetic', kind: 'person' }).expect(201);
    expect((await latestRow())?.summary).not.toHaveProperty('support');
  });

  it('revoke: at once support_required; idempotent; the list keeps it inactive; an unknown id is 404', async () => {
    const live = ((await admin('get', '/support').expect(200)).body as { id: string; active: boolean }[]).filter((x) => x.active);
    expect(live).toHaveLength(1);
    const id = live[0]?.id as string;
    const revoked = await admin('post', `/support/${id}/revoke`).expect(200);
    expect(revoked.body).toMatchObject({ id, active: false, revokedBy: ADMIN, login: SYS });
    expect((await latestRow())).toMatchObject({ operator: ADMIN, route: '/support/:id/revoke', entityIds: [id] });
    const again = await admin('post', `/support/${id}/revoke`).expect(200);
    expect(again.body.revokedAt).toBe(revoked.body.revokedAt);
    expect(answer(await sys('get', '/owners'))).toBe('403 support_required');
    expect(answer(await admin('post', `/support/${randomUUID()}/revoke`))).toBe('404 not_found');
    const all = (await admin('get', '/support').expect(200)).body as { active: boolean }[];
    expect(all.length).toBeGreaterThanOrEqual(3);
    expect(all.every((x) => !x.active)).toBe(true);
  });

  it('expiry: a grant that ran out is 403 support_expired, for enter too', async () => {
    const g = await grant({ expiresAt: inHours(1) });
    await sys('get', '/owners').expect(200);
    await pool.query("UPDATE auth.support_grants SET granted_at = now() - interval '2 days', expires_at = now() - interval '1 day' WHERE id = $1", [g.id]);
    expect(answer(await sys('get', '/owners'))).toBe('403 support_expired');
    expect(answer(await enter())).toBe('403 support_expired');
    // a new grant opens again
    await grant({ expiresAt: inHours(1) });
    await sys('get', '/owners').expect(200);
    await revokeAll();
  });
});
