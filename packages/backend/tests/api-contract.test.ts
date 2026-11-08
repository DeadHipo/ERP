import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { randomBytes, randomUUID } from 'node:crypto';
import { createApp } from '../src/api/app';
import { createServerApp } from '../src/api/server-app';
import { API_OPERATIONS, isOrgOperation, needsOperator, operationKey, RELABEL_OPERATIONS, type ApiOperation } from '../src/api/operations';
import { readsWithToken } from '../src/api/openapi';
import { buildOpenApiDocument } from '../src/api/openapi';
import { createAuthService } from '../src/auth/service';
import { createOrgFacades } from '../src/orgs/facades';
import { createOrgsService } from '../src/orgs/service';
import { newFacade, tmpPath, TMP, writeB17, writeBelieve } from './helpers/fixtures';
import { MANAGER_ANSWER } from './helpers/manager-answers';
import { testStack } from './helpers/test-sources';

// The API contract (operations list, response schemas, OpenAPI document) must match the real routes and the real
// responses. The scenario below calls every operation of the list once and parses its response with its schema.

const I1 = 'QZTST2600001';
const I2 = 'QZTST2600002';
const I3 = 'QZTST2600003';
const UPC = '1234567890123';

interface RouteLayer {
  route?: { path: string; methods: Record<string, boolean> };
  handle?: { stack?: RouteLayer[] };
}

/** All `METHOD /path` pairs of the Express routers mounted under /api/v1. */
function expressRoutes(app: Express): string[] {
  const out: string[] = [];
  const walk = (stack: RouteLayer[]) => {
    for (const layer of stack) {
      if (layer.route) {
        for (const m of Object.keys(layer.route.methods)) out.push(`${m.toUpperCase()} ${layer.route.path}`);
      } else if (layer.handle?.stack) walk(layer.handle.stack);
    }
  };
  walk((app as unknown as { router: { stack: RouteLayer[] } }).router.stack);
  return out;
}

/** The `erp_session=…` pair of a login's `Set-Cookie`. */
export function sessionCookieOf(res: { headers: Record<string, unknown> }): string {
  const set = res.headers['set-cookie'] as string[] | undefined;
  const pair = set?.find((c) => c.startsWith('erp_session='))?.split(';')[0];
  if (!pair) throw new Error('no session cookie');
  return pair;
}

type Access = ApiOperation['access'];

/**
 * The contract in one mode (D-170). `off`: `createApp(f)` (one organization + the system router), `/orgs*` with
 * `X-System-Key`. `on`: `createServerApp` over every organization, a user of the organization signs in, `/orgs*` under
 * the system administrator's session; the audit operator is the login of the session.
 */
function contractSuite(mode: 'off' | 'on') {
describe(`API contract (AUTH_MODE=${mode})`, () => {
  let app: Express;
  let orgId = '';
  const covered = new Set<string>();
  const SYSTEM_KEY = randomBytes(24).toString('hex');
  const SECRET = randomBytes(32).toString('hex');
  const PASSWORD = randomBytes(12).toString('hex');
  const suffix = randomUUID().slice(0, 8);
  const ORG_LOGIN = `contract-a-${suffix}`;
  const SYS_LOGIN = `contract-sys-${suffix}`;
  const cookies: Partial<Record<'org' | 'system', string>> = {};
  let orgs: ReturnType<typeof createOrgFacades>;
  /** The operator the audit records: the header in `off`, the session's login in `on`. */
  const operatorOf = (access: Access) => (mode === 'off' ? OPERATOR : access === 'system' ? SYS_LOGIN : ORG_LOGIN);
  const ORG_OPERATOR = mode === 'off' ? 'contract-test' : ORG_LOGIN;

  /** A supertest request with the credentials of `access`. */
  function authed<T extends request.Test>(t: T, access: Access): T {
    if (access === 'public') return t;
    if (mode === 'off') return (access === 'system' ? t.set('X-System-Key', SYSTEM_KEY) : t) as T;
    const cookie = cookies[access === 'system' ? 'system' : 'org'];
    return (cookie ? t.set('Cookie', cookie) : t) as T;
  }
  /** Requests of the organization (the reads and refusals of the scenario). */
  const R = {
    get: (url: string) => authed(request(app).get(url), 'org'),
    post: (url: string) => authed(request(app).post(url), 'org'),
    patch: (url: string) => authed(request(app).patch(url), 'org'),
  };

  beforeAll(async () => {
    const f = await newFacade();
    orgId = f.orgId;
    const stack = await testStack();
    const dataDir = join(TMP, `contract-${mode}-${suffix}`);
    mkdirSync(dataDir, { recursive: true });
    orgs = createOrgFacades({
      stores: { db: stack.db, pool: stack.pg.pool, columnar: stack.columnar },
      dataDir,
      payoutThresholdCents: 0,
    });
    if (mode === 'off') {
      app = createApp(f, { tmpDir: join(TMP, 'contract-uploads'), auth: { systemKey: SYSTEM_KEY }, orgs });
      return;
    }
    await stack.reset(); // the facades of the server read the sources directly (not through the reset-on-use proxy)
    const auth = createAuthService(stack.db);
    await auth.createUser({ login: ORG_LOGIN, password: PASSWORD, orgId, role: 'org_admin', createdBy: 'tests' });
    await auth.createUser({ login: SYS_LOGIN, password: PASSWORD, system: true, createdBy: 'tests' });
    app = createServerApp({
      orgs,
      auth: { service: auth, config: { mode: 'on', secret: SECRET, systemKey: SYSTEM_KEY } },
    });
    for (const [kind, login] of [['org', ORG_LOGIN], ['system', SYS_LOGIN]] as const) {
      const res = await request(app).post('/api/v1/auth/login').send({ login, password: PASSWORD }).expect(200);
      cookies[kind] = sessionCookieOf(res);
    }
  });

  /** Cents as the dollars string the API takes (no money arithmetic: string slicing). */
const centsText = (cents: number) => {
  const s = String(cents).padStart(3, '0');
  return `${s.slice(0, -2)}.${s.slice(-2)}`;
};
const OPERATOR = 'contract-test';
  let auditRows = 0;
  /** Every successful write leaves exactly one audit row, newest first, with the route template (R5, D-140). */
  async function expectOneAuditRow(
    method: string,
    template: string,
    params?: Record<string, string>,
    /** The label the row must carry (D-169); undefined = not checked. */
    labelId?: string | null,
    operator: string = ORG_OPERATOR,
  ) {
    const res = await R.get('/api/v1/audit').query({ limit: '500' }).expect(200);
    const items = res.body.items as {
      operator: string;
      method: string;
      route: string;
      entityIds: string[];
      labelId: string | null;
    }[];
    expect(items.length, `audit rows after ${method} ${template}`).toBe(auditRows + 1);
    auditRows = items.length;
    expect(items[0]).toMatchObject({ operator, method: method.toUpperCase(), route: template });
    for (const id of Object.values(params ?? {})) expect(items[0]?.entityIds).toContain(id);
    if (labelId !== undefined) expect(items[0]?.labelId, `audit label of ${method} ${template}`).toBe(labelId);
  }

  /** Calls an operation by its template path and checks status and response body against the contract. */
  async function call(
    method: 'get' | 'post' | 'patch',
    template: string,
    o: {
      params?: Record<string, string>;
      query?: Record<string, string>;
      body?: unknown;
      file?: { path: string; fileName: string };
      /** The label the audit row of a write must carry (D-169); undefined = not checked. */
      labelId?: string | null;
    } = {},
  ) {
    const op = API_OPERATIONS.find((x) => x.method === method && x.path === template);
    if (!op) throw new Error(`Operation ${method} ${template} is not in the contract`);
    const url =
      '/api/v1' +
      template.replace(/:([A-Za-z]+)/g, (_m, n: string) => encodeURIComponent(o.params?.[n] ?? ''));
    let req = authed(request(app)[method](url), op.access);
    if (needsOperator(op)) req = req.set('X-Operator', OPERATOR);
    if (o.query) req = req.query(o.query);
    if (o.file) req = req.attach('file', o.file.path, o.file.fileName);
    else if (o.body !== undefined) req = req.send(o.body as object);
    const res = await req;
    // a preview (`dryRun` not 0, D-172) answers 200 and leaves no audit row
    // D-173: an operation with a csv form answers text/csv for format=csv (UTF-8 with BOM, quoted fields)
    if (op.csv && o.query?.format === 'csv') {
      expect(res.status, `${operationKey(op)} csv -> ${res.text}`).toBe(200);
      expect(res.headers['content-type']).toMatch(/^text\/csv; charset=utf-8/);
      expect(res.headers['content-disposition']).toMatch(/^attachment; filename="[^"]+\.csv"/);
      expect(res.text.startsWith('\uFEFF"')).toBe(true);
      covered.add(operationKey(op));
      return { text: res.text, contentDisposition: res.headers['content-disposition'] } as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    }
    const isPreview = !!op.preview && o.query?.dryRun !== '0';
    expect(res.status, `${operationKey(op)} -> ${JSON.stringify(res.body)}`).toBe(isPreview ? 200 : (op.status ?? 200));
    const parsed = op.response.safeParse(res.body);
    expect(
      parsed.success ? null : parsed.error.issues,
      `${operationKey(op)} response does not fit its schema`,
    ).toBeNull();
    covered.add(operationKey(op));
    // the writes of the organization leave a row in its audit; a system write in the audit of its target
    // organization (here: the users of this one); the own password of a member in the session's one (D-171); login
    // and logout none
    if (isPreview) {
      const after = await R.get('/api/v1/audit').query({ limit: '500' }).expect(200);
      expect((after.body.items as unknown[]).length, `a preview of ${operationKey(op)} leaves no audit row`).toBe(auditRows);
    } else if (needsOperator(op) && (op.access === 'org' || o.params?.id === orgId || (op.access === 'user' && mode === 'on')))
      await expectOneAuditRow(method, template, o.params, o.labelId, operatorOf(op.access));
    return res.body as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  }

  it('every operation answers with a body that fits its schema', async () => {
    await call('get', '/health');

    // the login and the organizations (D-170)
    const me = await call('get', '/auth/me');
    if (mode === 'off') expect(me).toMatchObject({ authMode: 'off', user: null, org: { id: orgId }, role: 'local', allLabels: true });
    else
      expect(me).toMatchObject({
        authMode: 'on',
        user: { login: ORG_LOGIN, isSystemAdmin: false },
        org: { id: orgId },
        role: 'org_admin',
        allLabels: true,
        memberships: [{ orgId, role: 'org_admin' }],
      });
    const userLogin = `contract-u-${suffix}`;
    const createdUser = await call('post', '/orgs/:id/users', {
      params: { id: orgId },
      body: { login: userLogin.toUpperCase(), password: PASSWORD, role: 'org_admin' },
    });
    expect(createdUser).toMatchObject({ login: userLogin, role: 'org_admin', labelIds: [], active: true, disabled: false });
    const signedIn = await call('post', '/auth/login', { body: { login: userLogin, password: PASSWORD } });
    expect(signedIn.user).toMatchObject({ id: createdUser.id, login: userLogin });
    await call('post', '/auth/logout');
    // a manager needs own labels: none, a sublabel, a label of no organization are refused (D-171)
    const refusedMember = (labelIds: string[]) =>
      authed(request(app).post(`/api/v1/orgs/${orgId}/users`), 'system')
        .set('X-Operator', OPERATOR)
        .send({ login: `contract-x-${suffix}`, password: PASSWORD, role: 'label_manager', labelIds });
    expect((await refusedMember([])).body.error?.code).toBe('validation_error');
    expect((await refusedMember([randomUUID()])).body.error?.code).toBe('not_found');
    if (mode === 'on') {
      // several memberships: the login asks to choose (D-171)
      const multi = `contract-m-${suffix}`;
      const second = await createOrgsService((await testStack()).db).createOrganization({
        name: `Contract Multi ${suffix}`,
        createdBy: 'tests',
      });
      const svc = createAuthService((await testStack()).db);
      await svc.createUser({ login: multi, password: PASSWORD, orgId, role: 'org_admin', createdBy: 'tests' });
      await svc.addMembership({ login: multi, orgId: second.id, role: 'org_admin', labelIds: [], createdBy: 'tests' });
      const choose = await request(app).post('/api/v1/auth/login').send({ login: multi, password: PASSWORD }).expect(409);
      expect(choose.body.error).toMatchObject({ code: 'org_choice_required', details: { orgs: expect.any(Array) } });
      expect((choose.body.error.details.orgs as unknown[]).length).toBe(2);
      // the own password (the same one again: the scenario signs in with it later); the other sessions end
      const otherSession = sessionCookieOf(
        await request(app).post('/api/v1/auth/login').send({ login: ORG_LOGIN, password: PASSWORD }).expect(200),
      );
      await call('post', '/auth/password', { body: { current: PASSWORD, next: PASSWORD } });
      await request(app).get('/api/v1/auth/me').set('Cookie', otherSession).expect(401);
      await request(app).get('/api/v1/auth/me').set('Cookie', cookies.org as string).expect(200);
    } else {
      // AUTH_MODE=off has no user whose password could change: 401, the operation is covered by the `on` block
      await authed(request(app).post('/api/v1/auth/password'), 'user')
        .set('X-Operator', OPERATOR)
        .send({ current: PASSWORD, next: PASSWORD })
        .expect(401);
      covered.add('POST /auth/password');
    }
    const newOrg = await call('post', '/orgs', { body: { name: `Contract Org ${mode} ${suffix}` } });
    // a system write is recorded in the audit of its target organization, without the name
    const [orgRow] = await (await orgs.get(newOrg.id as string)).facade.recentActions(5);
    expect(orgRow).toMatchObject({ method: 'POST', route: '/orgs', operator: operatorOf('system'), entityIds: [newOrg.id] });
    expect(JSON.stringify(orgRow)).not.toContain('Contract Org');
    const orgList = await call('get', '/orgs');
    const mine = (orgList as unknown as { id: string; counts: { labels: number; users: number } }[]).find((o) => o.id === orgId);
    expect(mine?.counts.labels).toBeGreaterThanOrEqual(2);
    expect(mine?.counts.users).toBeGreaterThanOrEqual(1); // the active members
    const fresh = await call('get', '/orgs/:id', { params: { id: newOrg.id } });
    expect(fresh.counts).toEqual({ labels: 0, files: 0, statements: 0, owners: 0, users: 0 });
    const users = await call('get', '/orgs/:id/users', { params: { id: orgId } });
    expect((users as unknown as { login: string }[]).map((u) => u.login)).toContain(userLogin);
    expect(JSON.stringify(users)).not.toMatch(/scrypt|passwordHash/);

    // D-171: the members of the organization by its administrator, the system's members and users, support grants
    const memberUser = await call('post', '/users', { body: { login: `contract-mb-${suffix}`, password: PASSWORD, role: 'org_admin' } });
    expect(memberUser).toMatchObject({ login: `contract-mb-${suffix}`, role: 'org_admin', active: true });
    expect(((await call('get', '/users')) as unknown as { id: string }[]).map((u) => u.id)).toContain(memberUser.id);
    await call('patch', '/users/:id', { params: { id: memberUser.id }, body: { active: true } });
    await call('post', '/users/:id/password', { params: { id: memberUser.id }, body: { password: PASSWORD } });
    const elsewhere = await createOrgsService((await testStack()).db).createOrganization({ name: `Contract Else ${mode} ${suffix}`, createdBy: 'tests' });
    const outsider = await createAuthService((await testStack()).db).createUser({
      login: `contract-o-${mode}-${suffix}`,
      password: PASSWORD,
      orgId: elsewhere.id,
      role: 'org_admin',
      createdBy: 'tests',
    });
    const added = await call('post', '/orgs/:id/members', { params: { id: orgId }, body: { login: outsider.login, role: 'org_admin' } });
    expect(added).toMatchObject({ id: outsider.id, role: 'org_admin', active: true });
    const suspended = await call('patch', '/orgs/:id/users/:userId', { params: { id: orgId, userId: outsider.id }, body: { active: false } });
    expect(suspended.active).toBe(false);
    const everyone = (await call('get', '/system/users')) as unknown as { id: string; memberships: { orgId: string }[] }[];
    expect(everyone.find((u) => u.id === outsider.id)?.memberships.map((m) => m.orgId).sort()).toEqual([orgId, elsewhere.id].sort());
    expect(JSON.stringify(everyone)).not.toMatch(/scrypt|passwordHash/);
    expect((await call('patch', '/system/users/:id', { params: { id: outsider.id }, body: { disabled: false } })).disabled).toBe(false);
    await call('post', '/system/users/:id/password', { params: { id: outsider.id }, body: { password: PASSWORD } });
    if (mode === 'off') await createAuthService((await testStack()).db).createUser({ login: SYS_LOGIN, password: PASSWORD, system: true, createdBy: 'tests' });
    const grant = await call('post', '/support', { body: { login: SYS_LOGIN, write: true } });
    expect(grant).toMatchObject({ login: SYS_LOGIN, write: true, active: true });
    if (mode === 'on') {
      const entered = await call('post', '/orgs/:id/support/enter', { params: { id: orgId } });
      expect(entered).toMatchObject({ role: 'support', org: { id: orgId }, support: { orgId, write: true } });
      const asSupport = (path: string) => request(app).get(`/api/v1${path}`).set('Cookie', cookies.system as string).set('X-Org', orgId);
      await asSupport('/owners').expect(200);
      expect((await asSupport('/users')).body.error?.code).toBe('forbidden');
    } else {
      // the system key has no user to grant to: never support (the operation is covered by the `on` block)
      const refusedEnter = await authed(request(app).post(`/api/v1/orgs/${orgId}/support/enter`), 'system').set('X-Operator', OPERATOR);
      expect([refusedEnter.status, refusedEnter.body.error?.code]).toEqual([403, 'support_required']);
      covered.add('POST /orgs/:id/support/enter');
    }
    expect(((await call('get', '/support')) as unknown as { id: string }[]).map((g) => g.id)).toContain(grant.id);
    expect((await call('post', '/support/:id/revoke', { params: { id: grant.id } })).active).toBe(false);
    if (mode === 'on') {
      const after = await request(app).get('/api/v1/owners').set('Cookie', cookies.system as string).set('X-Org', orgId);
      expect([after.status, after.body.error?.code]).toEqual([403, 'support_required']);
    }

    // module 1
    const owner = await call('post', '/owners', { body: { name: 'Ivan Synthetic', kind: 'person' } });
    const other = await call('post', '/owners', { body: { name: 'Petr Synthetic', kind: 'person' } });
    await call('get', '/owners');
    const a1 = await call('post', '/artists', { body: { pseudonym: 'Synth One', ownerId: owner.id } });
    const a2 = await call('post', '/artists', { body: { pseudonym: 'Synth Two' } });
    await call('post', '/artists/:id/owner', { params: { id: a2.id }, body: { ownerId: other.id } });
    await call('get', '/artists');
    await call('get', '/artists/duplicates');
    await call('get', '/search', { query: { q: 'synth', kinds: 'owners,artists' } });
    await call('get', '/artists/:id', { params: { id: a1.id } });
    const card = await call('get', '/artists/:id', { params: { id: a1.id } });
    expect([card.artist.id, card.owner?.id, card.merged]).toEqual([a1.id, owner.id, false]);
    await call('get', '/artists/:id/balance', { params: { id: a1.id }, query: { from: '2026-07', to: '2026-07' } });
    const balances = await call('get', '/artists/balances', { query: { ids: `${a1.id},${a2.id}` } });
    expect(balances.items.map((i: { artistId: string }) => i.artistId).sort()).toEqual([a1.id, a2.id].sort());
    const t1 = await call('post', '/tracks', { body: { title: 'Track One', isrc: I1, upc: UPC } });
    await call('post', '/tracks', { body: { title: 'Track Two', isrc: I2, upc: UPC } });
    await call('post', '/tracks', { body: { title: 'Track Three', isrc: I3, upc: UPC } });
    await call('patch', '/tracks/:id', { params: { id: t1.id }, body: { isrc: I1, upc: UPC } });
    await call('get', '/tracks');
    const noted = await call('patch', '/tracks/:id', {
      params: { id: t1.id },
      body: { note: 'check the rights' },
    });
    expect(noted.note).toBe('check the rights');
    const assumption = await call('post', '/documents', {
      body: { kind: 'assumption', title: 'Council decision', requiresApproval: false },
    });

    const contractDoc = await call('post', '/documents', {
      body: { kind: 'contract', title: 'Contract', ownerId: owner.id, requiresApproval: true },
    });
    await call('post', '/documents/:id/attach', {
      params: { id: contractDoc.id },
      body: { fileRef: 'dummy://c.pdf' },
    });
    await call('post', '/documents/:id/approve', { params: { id: contractDoc.id }, body: {} });
    const contract = await call('post', '/contracts', {
      body: { ownerId: owner.id, documentId: contractDoc.id, artistIds: [a1.id] },
    });
    // the admission (D-176): the threshold of the contract, a payee, a hold, an answer, the list, the rollbacks
    expect((await call('patch', '/contracts/:id', { params: { id: contract.id }, body: { payoutThresholdCents: 100 } })).payoutThresholdCents).toBe(100);
    // the rows of `other` (deactivated at once): the organization uses the admission from here on; the owner keeps an active payee
    const payee = await call('post', '/settlements/payees', { body: { ownerId: other.id, channel: 'tipalti', payeeRef: '1', basis: 'contract', validFrom: '2026-01-01' } });
    const hold = await call('post', '/settlements/holds', { body: { ownerId: owner.id, kind: 'question', reason: 'contract', since: '2026-01-01' } });
    const answer = await call('post', '/settlements/answers', { body: { ownerId: other.id, due: '1.00', decision: 'pay', why: 'contract', answeredBy: 'contract' } });
    const admission = await call('get', '/settlements/admission', { query: { ownerId: other.id, active: 'false' } });
    expect([admission.active, admission.payees.length, admission.holds.length, admission.answers.length]).toEqual([true, 1, 0, 1]);
    expect((await call('post', '/settlements/holds/:id/release', { params: { id: hold.id }, body: { reason: 'contract' } })).status).toBe('released');
    expect((await call('post', '/settlements/answers/:id/deactivate', { params: { id: answer.id }, body: { reason: 'contract' } })).active).toBe(false);
    expect((await call('post', '/settlements/payees/:id/deactivate', { params: { id: payee.id }, body: { reason: 'contract' } })).active).toBe(false);
    await call('post', '/settlements/payees', { body: { ownerId: owner.id, channel: 'easystaff', basis: 'contract', validFrom: '2026-01-01' } });
    const appendix = await call('post', '/documents', {
      body: { kind: 'appendix', title: 'Appendix', fileRef: 'dummy://a.pdf', requiresApproval: false },
    });
    const buyoutDoc = await call('post', '/documents', {
      body: { kind: 'buyout', title: 'Buyout', fileRef: 'dummy://b.pdf', requiresApproval: false },
    });
    await call('get', '/documents', { query: { ownerId: owner.id } });
    const filtered = await call('get', '/documents', {
      query: { status: 'not_attached', kind: 'buyout', q: 'buy', limit: '5' },
    });
    expect(filtered).toEqual({ total: 0, limit: 5, offset: 0, items: [] }); // `limit` gives a page (D-177)

    // splits
    await call('post', '/splits', {
      body: {
        isrc: I1,
        validFrom: '2026-01-01',
        shares: [{ artistId: a1.id, percent: '50' }],
        documentId: appendix.id,
      },
    });
    await call('post', '/splits/change', {
      body: {
        isrc: I1,
        from: '2026-09-01',
        shares: [{ artistId: a1.id, percent: '40' }],
        documentId: appendix.id,
      },
    });
    const unconfirmed = await call('post', '/splits', {
      body: { isrc: I2, validFrom: '2026-01-01', shares: [{ artistId: a1.id, percent: '10' }] },
    });
    await call('post', '/splits/:id/confirm', {
      params: { id: unconfirmed.id },
      body: { documentId: appendix.id },
    });
    await call('post', '/splits/buyout', {
      body: { isrcs: [I2], sellerArtistId: a1.id, effectiveFrom: '2026-06-01', documentId: buyoutDoc.id },
    });
    await call('get', '/splits', { query: { isrc: I1 } });
    await call('get', '/splits', { query: { status: 'unconfirmed', limit: '1', offset: '0' } });
    await call('post', '/splits', {
      body: {
        isrc: I3,
        validFrom: '2026-01-15',
        shares: [{ artistId: a1.id, percent: '20', documentId: assumption.id }],
      },
    });

    // labels
    const own = await call('post', '/labels', { body: { name: 'Own Synthetic', kind: 'own' } });
    const sub = await call('post', '/labels', {
      body: { name: 'Sub Synthetic', kind: 'sublabel', ownLabelId: own.id },
    });
    await call('post', '/labels/:id/aliases', { params: { id: sub.id }, body: { alias: 'Sub Imprint' } });
    const rule = await call('post', '/labels/:id/rules', {
      params: { id: sub.id },
      body: { percent: '30', recipientArtistId: a2.id, validFrom: '2026-02-10', documentId: appendix.id },
      labelId: null, // the response's labelId is the sublabel: never recorded (D-169)
    });
    expect(rule.validFrom).toBe('2026-02-01');
    const labelList = await call('get', '/labels');
    expect(
      (labelList as unknown as { rules: { recipientPseudonym: string }[] }[]).flatMap((l) => l.rules)[0]
        ?.recipientPseudonym,
    ).toBe('Synth Two');
    // D-168: a Believe account under an own label; the seeded 0to8 is the label of every operation below
    const zero = (labelList as unknown as { id: string; name: string }[]).find((l) => l.name === '0to8') as { id: string };
    // D-169: a document under a label; PATCH sets and clears it; the list under a label adds those without a label
    const labelled = await call('post', '/documents', {
      body: { kind: 'other', title: 'Labelled', requiresApproval: false, labelId: zero.id },
      labelId: zero.id,
    });
    expect(labelled.labelId).toBe(zero.id);
    const moved = await call('patch', '/documents/:id', { params: { id: labelled.id }, body: { labelId: own.id }, labelId: own.id });
    expect(moved.labelId).toBe(own.id);
    expect((await call('get', '/documents', { query: { label: zero.id } })).map((d: { id: string }) => d.id)).toEqual(
      expect.arrayContaining([contractDoc.id]),
    );
    expect((await call('get', '/documents', { query: { label: zero.id } })).map((d: { id: string }) => d.id)).not.toContain(labelled.id);
    const cleared = await call('patch', '/documents/:id', { params: { id: labelled.id }, body: { labelId: null }, labelId: null });
    expect(cleared.labelId).toBeNull();
    const subRefused = (await R.patch(`/api/v1/documents/${labelled.id}`).set('X-Operator', OPERATOR).send({ labelId: sub.id }))
      .body as { error: { code: string } };
    expect(subRefused.error.code).toBe('label_not_own');
    // (1052428 → 0to8 and 1055956 → Echo8 are registered by newFacade, D-169)
    const withAccount = await call('post', '/labels/:id/accounts', { params: { id: own.id }, body: { account: '2799001' } });
    expect(withAccount.accounts).toEqual(['2799001']);
    const withoutAccount = await call('post', '/labels/:id/accounts/:account/remove', {
      params: { id: own.id, account: '2799001' },
    });
    expect(withoutAccount.accounts).toEqual([]);
    await call('post', '/labels/rules/:id/close', {
      params: { id: rule.id },
      body: { validTo: '2026-06-01' },
    });

    // participations
    const part = await call('post', '/participations', {
      body: {
        isrc: I1,
        artistId: a2.id,
        percent: '5',
        base: 'net',
        fundedFrom: 'top',
        validFrom: '2026-03-20',
        documentId: appendix.id,
      },
    });
    expect(part.validFrom).toBe('2026-03-01');
    const plist = await call('get', '/participations', { query: { isrc: I1 } });
    expect(plist.total).toBe(1);
    const ppage = await call('get', '/participations', { query: { limit: '1', offset: '1' } });
    expect(ppage.items).toEqual([]);
    await call('post', '/participations/:id/close', {
      params: { id: part.id },
      body: { validTo: '2026-09-01' },
    });

    // sources and publishing: a file is loaded under the own label of its account (D-169)
    const refused = async (url: string, query: Record<string, string>, file: { path: string; fileName: string }) =>
      (await R.post(url).set('X-Operator', OPERATOR).query(query).attach('file', file.path, file.fileName))
        .body as { error: { code: string; details?: unknown } };
    const july = writeBelieve('2026-07', [
      { isrc: I1, upc: UPC, net: '300' },
      { isrc: I3, upc: UPC, net: '5' },
    ]);
    expect((await refused('/api/v1/sources/believe', {}, july)).error.code).toBe('label_required');
    expect((await refused('/api/v1/sources/believe', { label: sub.id }, july)).error.code).toBe('label_not_own');
    const unregistered = writeBelieve('2026-07', [{ isrc: I1, upc: UPC, net: '1' }], { account: '2799002' });
    expect((await refused('/api/v1/sources/believe', { label: zero.id }, unregistered)).error).toMatchObject({
      code: 'account_unregistered',
      details: { account: '2799002' },
    });
    const echoFile = writeBelieve('2026-07', [{ isrc: I1, upc: UPC, net: '1' }], { account: '1055956' });
    const echoLabel = (labelList as unknown as { id: string; name: string }[]).find((l) => l.name === 'Echo8') as { id: string };
    expect((await refused('/api/v1/sources/believe', { label: zero.id }, echoFile)).error).toMatchObject({
      code: 'account_of_other_label',
      details: { account: '1055956', labelId: echoLabel.id, labelName: 'Echo8' },
    });
    const loaded = await call('post', '/sources/believe', { query: { label: zero.id }, file: july });
    expect([loaded.labelId, loaded.uploadedBy]).toEqual([zero.id, ORG_OPERATOR]);
    // an account with files is not removed
    const blocked = await R
      .post(`/api/v1/labels/${zero.id}/accounts/1052428/remove`)
      .set('X-Operator', OPERATOR);
    expect([blocked.status, blocked.body.error.code, blocked.body.error.details]).toEqual([
      409,
      'account_has_files',
      { account: '1052428', files: 1 },
    ]);
    await call('get', '/sources/files');
    const ofZero = await call('get', '/sources/files', { query: { label: zero.id } });
    expect(ofZero.believe.map((x: { id: string }) => x.id)).toEqual([loaded.id]);
    const ofEcho = await call('get', '/sources/files', { query: { label: echoLabel.id } });
    expect(ofEcho.believe).toEqual([]);
    await call('get', '/sources/lines', { query: { limit: '5' } });
    const echoLines = await call('get', '/sources/lines', { query: { limit: '5', label: echoLabel.id } });
    expect([echoLines.files, echoLines.items]).toEqual([[], []]);
    await call('get', '/sources/lines/facets');
    const zeroFacets = await call('get', '/sources/lines/facets', { query: { label: zero.id } });
    expect(zeroFacets.files.map((x: { id: string }) => x.id)).toEqual([loaded.id]);
    const b17File = await writeB17('Q22026', [{ writer: 'Writer Synthetic', title: 'Song', payable: 100 }]);
    expect((await refused('/api/v1/publishing/b17', {}, b17File)).error.code).toBe('label_required');
    const b17 = await call('post', '/publishing/b17', { query: { label: zero.id }, file: b17File });
    expect(b17.statement.labelId).toBe(zero.id);
    // the replacement of the statement (D-173): the same quarter and amounts, other bytes; the old one superseded
    const b17Fix = await writeB17('Q22026', [{ writer: 'Writer Synthetic', title: 'Song', payable: 100 }, { writer: 'Writer Synthetic', title: 'Song', payable: 0 }], '0to8_Q22026_Publishing_Statement_Fix.xlsx');
    expect((await refused(`/api/v1/publishing/statements/${b17.statement.id}/replace`, {}, b17Fix)).error.code).toBe('label_required');
    const b17Replaced = await call('post', '/publishing/statements/:id/replace', { params: { id: b17.statement.id }, query: { label: zero.id }, file: b17Fix, labelId: zero.id });
    expect([b17Replaced.superseded.status, b17Replaced.superseded.replacedBy, b17Replaced.statement.totalPayable]).toEqual(['superseded', b17Replaced.statement.id, '100']);
    // publishing v2 (D-182): a report summary as a partition, the list, the removal
    const pubV2Book = new ExcelJS.Workbook();
    pubV2Book.addWorksheet('Songwriter Breakdown').addRows([
      ['SONG', 'GROSS', 'WITHHOLDING', 'TOTAL PAYABLE'],
      ['SONGWRITER: Writer Synthetic', 3, 1, 2],
      ['  Song', 3, 1, 2],
    ]);
    const pubV2Path = tmpPath('contract-pubv2.xlsx');
    await pubV2Book.xlsx.writeFile(pubV2Path);
    const pubV2Upload = { path: pubV2Path, fileName: '0to8_Q22026_Publishing_Statement.xlsx' };
    expect((await refused('/api/v1/publishing-v2/files', {}, pubV2Upload)).error.code).toBe('label_required');
    const pubV2File = await call('post', '/publishing-v2/files', { query: { label: zero.id }, file: pubV2Upload });
    expect(pubV2File.payable).toBe('2');
    expect((await call('get', '/publishing-v2/files')).map((x: { id: string }) => x.id)).toContain(pubV2File.id);
    const pubV2Writers = await call('get', '/publishing-v2/songwriters', { query: { label: zero.id } });
    expect((await call('get', '/publishing-v2/songwriters/:id', { params: { id: pubV2Writers[0].id } })).songs.length).toBe(1);
    const pubV2Owner = await call('post', '/owners', { body: { name: 'Writer Synthetic Owner', kind: 'person' } });
    await call('post', '/publishing-v2/links', { body: { songwriterId: pubV2Writers[0].id, ownerId: pubV2Owner.id } });
    expect((await call('get', '/publishing-v2/links')).find((l: { songwriterId: string }) => l.songwriterId === pubV2Writers[0].id).link.ownerId).toBe(pubV2Owner.id);
    const pubV2Term = await call('post', '/publishing-v2/terms', { body: { ownerId: pubV2Owner.id, percent: '50', validFrom: '2026-01-01' } });
    expect(pubV2Term.percent).toBe('50');
    expect((await call('post', '/publishing-v2/terms/:id/cancel', { params: { id: pubV2Term.id }, body: { reason: 'contract check' } })).reopened).toBeNull();
    const pubV2Songs = await call('get', '/publishing-v2/songs');
    const pubV2Song = pubV2Songs.find((x: { songwriterId: string }) => x.songwriterId === pubV2Writers[0].id);
    expect((await call('get', '/publishing-v2/songs/:id/candidates', { params: { id: pubV2Song.songId } })).isrcs).toEqual([]);
    expect((await call('post', '/publishing-v2/songs/:id/isrcs', { params: { id: pubV2Song.songId }, body: { isrcs: [] } })).isrcs).toEqual([]);
    await call('post', '/publishing-v2/files/:id/remove', { params: { id: pubV2File.id } });
    // the split import (D-172): a refusal, the preview (no audit row), the apply
    const importFile = tmpPath('contract-splits.csv');
    writeFileSync(importFile, 'isrc,pseudonym,percent,from,document\nQZTST2600088,Contract Import Synth,25,2026-02-15,\n');
    const importUpload = { path: importFile, fileName: 'contract-splits.csv' };
    expect((await refused('/api/v1/splits/import', {}, importUpload)).error.code).toBe('label_required');
    const importPreview = await call('post', '/splits/import', { query: { label: zero.id }, file: importUpload });
    expect([importPreview.applied, importPreview.totals.create, importPreview.rows[0].fromFloored]).toEqual([false, 1, '2026-02-01']);
    const imported = await call('post', '/splits/import', { query: { label: zero.id, dryRun: '0' }, file: importUpload, labelId: zero.id });
    expect(imported.result.splitIds).toHaveLength(1);
    // the assumption (D-172): the imported split has no document; one assumption document under the label
    const assumed = await call('post', '/splits/assume', { body: { labelId: zero.id, isrcs: ['QZTST2600088'], reason: 'contract synthetic' }, labelId: zero.id });
    expect([assumed.assigned, assumed.skipped]).toEqual([imported.result.splitIds, []]);
    const writers = await call('get', '/publishing/writers');
    await call('post', '/publishing/writers/resolve');
    await call('post', '/publishing/writers/:norm/map', {
      params: { norm: (writers as unknown as { writerNorm: string }[])[0]?.writerNorm ?? '' },
      body: { ownerId: owner.id },
    });
    await call('post', '/publishing/terms', {
      body: { ownerId: owner.id, percent: '50', validFrom: '2026-01-01' },
    });
    const typed = await call('post', '/publishing/terms', {
      body: { ownerId: owner.id, percent: '60', validFrom: '2026-02-01', operationType: 'Performance' },
    });
    expect(typed.operationType).toBe('Performance');

    // views
    await call('get', '/owners/:id', { params: { id: owner.id } });
    await call('get', '/owners/:id/balance', {
      params: { id: owner.id },
      query: { from: '2026-07', to: '2026-07' },
    });
    const underLabel = await call('get', '/owners/:id/balance', { params: { id: owner.id }, query: { label: zero.id } });
    expect(underLabel.label).toEqual({ id: zero.id, name: '0to8' });
    await call('get', '/reconciliation', { query: { from: '2026-07', to: '2026-07' } });
    await call('get', '/signals');
    await call('get', '/signals', { query: { label: zero.id } });
    // D-172: the onboarding checklists (reads only); under «Все» the label one is 400 label_required
    const checklist = await call('get', '/onboarding', { query: { label: zero.id } });
    expect(checklist.label).toEqual({ id: zero.id, name: '0to8' });
    expect((checklist.steps as { key: string }[]).map((s) => s.key)).toEqual(['label', 'accounts', 'files', 'unmapped', 'catalog', 'splits', 'owners', 'documents', 'publishing']);
    expect((await R.get('/api/v1/onboarding')).body.error?.code).toBe('label_required');
    const orgChecklist = await call('get', '/onboarding/organization');
    expect(orgChecklist.org).toEqual({ id: orgId });
    const overview = await call('get', '/overview', { query: { from: '2026-07', to: '2026-07' } });
    // D-160: the totals are the backend's sums of the rows (the client never sums); a one-row period equals its row
    const [oneRow] = overview.reconciliation as { A_received: string; account: string; source: string }[];
    if (oneRow && overview.reconciliation.length === 1) {
      expect(overview.totals.all.received).toBe(oneRow.A_received);
      expect(overview.totals.byAccount).toEqual([expect.objectContaining({ source: oneRow.source, account: oneRow.account, received: oneRow.A_received })]);
    }
    expect(overview.totals.all.discrepancy).toBe('0');
    await call('get', '/queue/:reason', { params: { reason: 'split_unconfirmed' }, query: { limit: '10' } });
    await call('get', '/queue/:reason', { params: { reason: 'split_unconfirmed' }, query: { limit: '10', label: zero.id } });
    await call('get', '/queue/:reason', {
      params: { reason: 'writer_unmapped' },
      query: { month: '2026-07' },
    });
    await call('get', '/tracks/:isrc/explain', { params: { isrc: I1 } });
    await call('get', '/owners/payables', { query: { from: '2026-07', to: '2026-07' } });
    await call('get', '/owners/payables', { query: { ids: `${owner.id},${other.id}` } });
    await call('get', '/owners/payables', { query: { label: zero.id } });
    // D-173: asOf and the area of the gate; the payroll of a label, json and one csv sheet
    await call('get', '/owners/payables', { query: { label: zero.id, asOf: '2026-07', area: 'master' } });
    await call('get', '/owners/:id/balance', { params: { id: owner.id }, query: { asOf: '2026-07', area: 'publishing' } });
    const payroll = await call('get', '/owners/payroll', { query: { label: zero.id, asOf: '2026-07', area: 'all' } });
    expect(payroll.label).toEqual({ id: zero.id, name: '0to8' });
    const payrollCsv = await call('get', '/owners/payroll', { query: { label: zero.id, format: 'csv', sheet: 'control' } });
    expect(payrollCsv.text.split('\r\n')[0]).toBe('\uFEFF"source";"account";"month";"A";"B";"C";"ours";"discrepancy"');
    expect(payrollCsv.contentDisposition).toContain('payroll_0to8_all_master_control.csv');
    expect((await R.get('/api/v1/owners/payroll')).body.error?.code).toBe('label_required');
    await call('get', '/owners', { query: { label: zero.id } });
    await call('get', '/artists', { query: { label: zero.id } });
    await call('get', '/artists/balances', { query: { label: zero.id } });
    await call('get', '/artists/:id/balance', { params: { id: a1.id }, query: { label: zero.id } });
    await call('get', '/tracks/summary', { query: { month: '2026-07' } });
    await call('get', '/tracks/summary', { query: { label: zero.id } });
    await call('get', '/tracks/catalog', { query: { label: zero.id } });
    // the label history of an ISRC (D-172): an operator interval, the whole history in the answer
    const history = await call('post', '/tracks/:isrc/label', { params: { isrc: I3 }, body: { labelId: zero.id, from: '2026-07-15' } });
    expect(history).toEqual([expect.objectContaining({ labelId: zero.id, validFrom: '2026-07-01', validTo: null, source: 'operator' })]);
    expect(await call('get', '/tracks/:isrc/labels', { params: { isrc: I3 } })).toEqual(history);
    await call('get', '/tracks/catalog', { query: { label: zero.id, catalog: 'current' } });
    await call('get', '/releases', { query: { label: zero.id } });
    await call('get', '/releases/:upc', { params: { upc: UPC }, query: { label: zero.id } });
    // the release registry (D-172): the Believe release export of the label (synthetic), the registry read
    const releaseFile = tmpPath('contract-releases.csv');
    writeFileSync(
      releaseFile,
      '\uFEFF"Release Title";Version;Artist;Label;"Release date / Hour / Time zone";"# of track";UPC;"Cat. #";"# of territories";"# of stores"\n' +
        `"Release R-1";;"Synth Artist";SynthLabel;"2026-01-15<br />00:00:00";2;"UPC : ${UPC}";;240;23\n`,
    );
    const releaseUpload = { path: releaseFile, fileName: 'contract-releases.csv' };
    expect((await refused('/api/v1/releases/preview', {}, releaseUpload)).error.code).toBe('label_required');
    const releasePreview = await call('post', '/releases/preview', { query: { label: zero.id, source: 'believe' }, file: releaseUpload });
    expect(releasePreview.totals).toMatchObject({ rows: 1, create: 1 });
    const releaseChanges = (releasePreview.items as { upc: string; action: string; release: unknown; before: unknown }[]).map((i) => ({
      upc: i.upc,
      action: i.action,
      release: i.release,
      before: i.before,
    }));
    const releasesApplied = await call('post', '/releases/preview/apply', { query: { label: zero.id }, body: { changes: releaseChanges }, labelId: zero.id });
    expect([releasesApplied.created, releasesApplied.updated]).toEqual([1, 0]);
    const registry = await call('get', '/releases/registry', { query: { label: zero.id } });
    expect(registry.items.map((r: { upc: string }) => r.upc)).toEqual([UPC]);
    await call('get', '/releases/registry', { query: { q: 'r-1' } });
    await call('get', '/tracks/summary', { query: { isrcs: `${I1},${I2}` } });
    const catalogItems = await call('get', '/tracks/catalog');
    // D-166: the pseudonyms of the registry on the ISRC (the split row of a1), the artist string of the report apart
    expect(catalogItems.items.find((i: { isrc: string }) => i.isrc === I1)?.artists).toEqual(
      expect.arrayContaining([{ id: a1.id, pseudonym: 'Synth One' }]),
    );
    await call('get', '/tracks/:isrc/money', { params: { isrc: I1 } });
    await call('get', '/tracks/:isrc/breakdown/:month', { params: { isrc: I1, month: '2026-07' } });
    await call('get', '/releases', { query: { q: UPC } });
    await call('get', '/releases/:upc', { params: { upc: UPC } });
    await call('get', '/documents/:id/uses', { params: { id: contractDoc.id } });

    // settlements: the first payout of the owner needs an answer «pay» for its amount (D-176)
    const beforePayout = await call('get', '/owners/:id/balance', { params: { id: owner.id }, query: { label: zero.id, area: 'all' } });
    expect(beforePayout.payout.reason).toBe('needs_answer');
    await call('post', '/settlements/answers', { body: { ownerId: owner.id, labelId: zero.id, due: centsText(beforePayout.payout.amountCents), decision: 'pay', why: 'contract', answeredBy: 'contract' } });
    const payout = await call('post', '/owners/:id/payouts', { params: { id: owner.id }, body: { labelId: zero.id, area: 'all' }, labelId: zero.id });
    expect(payout.labelId).toBe(zero.id);
    await call('get', '/settlements/operations/:id/snapshot', { params: { id: payout.id } });
    await call('post', '/settlements/operations/:id/deferred', {
      params: { id: payout.id },
      body: { deferred: true },
      labelId: zero.id, // from the response (D-169)
    });
    await call('post', '/settlements/operations/:id/proof', {
      params: { id: payout.id },
      body: { fileRef: 'dummy://p.pdf' },
      labelId: zero.id,
    });
    const deduction = await call('post', '/settlements/operations', {
      body: { direction: 'in', amount: '1.00', artistId: a1.id, date: '2026-08-01', comment: 'penalty', labelId: zero.id },
      labelId: zero.id,
    });
    // the relabel needs a reason (D-173): the label source becomes operator, the previous label is in the answer
    const noReason = await R.patch(`/api/v1/settlements/operations/${deduction.id as string}`).set('X-Operator', OPERATOR).send({ labelId: own.id });
    expect([noReason.status, noReason.body.error?.code]).toEqual([400, 'reason_required']);
    const relabelled = await call('patch', '/settlements/operations/:id', {
      params: { id: deduction.id },
      body: { labelId: own.id, reason: 'paid by the other book' },
      labelId: own.id,
    });
    expect([relabelled.labelId, relabelled.labelSource, relabelled.fromLabelId, relabelled.kind]).toEqual([own.id, 'operator', zero.id, 'deduction']);
    await call('post', '/settlements/operations/:id/deactivate', {
      params: { id: deduction.id },
      body: { reason: 'mistake' },
      labelId: own.id,
    });
    await call('post', '/settlements/operations/:id/return', {
      params: { id: payout.id },
      body: { fileRef: 'dummy://r.pdf', date: '2099-12-31', comment: 'bounced' },
      labelId: zero.id,
    });
    // the kinds of the payroll (D-173 commit 2): a buyout, an adjustment, a write-off refused above the publishing, the
    // forgiveness of a counted advance
    const adjustBasis = await call('post', '/documents', {
      body: { kind: 'adjustment_basis', title: 'Adjustment', ownerId: owner.id, fileRef: 'dummy://adj.pdf', requiresApproval: false },
    });
    const buyoutOp = await call('post', '/settlements/operations', {
      body: { kind: 'buyout', direction: 'out', amount: '10.00', ownerId: owner.id, date: '2026-08-01', documentId: buyoutDoc.id, comment: 'buyout', labelId: zero.id },
      labelId: zero.id,
    });
    expect([buyoutOp.kind, buyoutOp.area]).toEqual(['buyout', 'master']);
    const adjustmentOp = await call('post', '/settlements/operations', {
      body: { kind: 'adjustment', direction: 'in', amount: '-1.50', ownerId: owner.id, date: '2026-08-01', documentId: adjustBasis.id, comment: 'adjustment', labelId: zero.id },
      labelId: zero.id,
    });
    expect([adjustmentOp.kind, adjustmentOp.amountCents]).toEqual(['adjustment', -150]);
    const writeoffRefused = await R.post('/api/v1/settlements/operations')
      .set('X-Operator', OPERATOR)
      .send({ kind: 'writeoff', direction: 'in', amount: '1000000.00', ownerId: owner.id, date: '2026-08-01', documentId: adjustBasis.id, comment: 'write-off', labelId: zero.id });
    expect([writeoffRefused.status, writeoffRefused.body.error?.code]).toEqual([422, 'writeoff_exceeds']);
    const advanceBasis = await call('post', '/documents', {
      body: { kind: 'advance_basis', title: 'Advance', ownerId: owner.id, fileRef: 'dummy://adv.pdf', requiresApproval: false },
    });
    const advanceOp = await call('post', '/settlements/operations', {
      body: { kind: 'advance', direction: 'out', amount: '5.00', artistId: a1.id, date: '2026-12-01', scope: { kind: 'any' }, documentId: advanceBasis.id, comment: 'advance', labelId: zero.id },
      labelId: zero.id,
    });
    await call('post', '/settlements/operations/:id/proof', { params: { id: advanceOp.id }, body: { fileRef: 'dummy://adv-proof.pdf' }, labelId: zero.id });
    const forgiven = await call('post', '/settlements/operations/:id/forgive', {
      params: { id: advanceOp.id },
      body: { amount: '1.00', date: '2026-12-15', documentId: adjustBasis.id, comment: 'forgiven' },
      labelId: zero.id,
    });
    expect([forgiven.kind, forgiven.operationRef, forgiven.labelId, forgiven.amountCents]).toEqual(['forgiveness', advanceOp.id, zero.id, 100]);
    const tooMuch = await R.post(`/api/v1/settlements/operations/${advanceOp.id as string}/forgive`)
      .set('X-Operator', OPERATOR)
      .send({ amount: '4.01', date: '2026-12-15', documentId: adjustBasis.id, comment: 'more' });
    expect([tooMuch.status, tooMuch.body.error?.code, tooMuch.body.error?.details]).toEqual([422, 'forgiveness_exceeds', { unrecouped: '4' }]);
    // the operation import (D-173 §1.5): a refusal, the preview (no audit row), the apply (migrated payouts)
    const opsFile = tmpPath('contract-operations.csv');
    writeFileSync(opsFile, `owner,date,amount,kind,external_id,channel\n${owner.id as string},2026-08-02,2.50,payout,contract-cash-1,Synthetic cash\n`);
    const opsUpload = { path: opsFile, fileName: 'contract-operations.csv' };
    expect((await refused('/api/v1/settlements/operations/import', {}, opsUpload)).error.code).toBe('label_required');
    const opsPreview = await call('post', '/settlements/operations/import', { query: { label: zero.id }, file: opsUpload });
    expect([opsPreview.applied, opsPreview.totals.create]).toEqual([false, 1]);
    const opsImported = await call('post', '/settlements/operations/import', { query: { label: zero.id, dryRun: '0' }, file: opsUpload, labelId: zero.id });
    expect(opsImported.result.operationIds).toHaveLength(1);
    // the opening balances (D-174): a preview, an apply, the list of the book, a soft rollback
    const startFile = tmpPath('contract-start.csv');
    writeFileSync(startFile, 'pseudonym;master;publishing\nSynth One;12.5;0\n');
    const startUpload = { path: startFile, fileName: 'contract-start.csv' };
    const startQuery = { label: zero.id, cutoff: '2026-06', syncedAt: '2026-07-01T00:00:00Z', basis: 'contract snapshot' };
    expect((await refused('/api/v1/settlements/start/import', { cutoff: '2026-06', syncedAt: '2026-07-01T00:00:00Z' }, startUpload)).error.code).toBe('label_required');
    const startPreview = await call('post', '/settlements/start/import', { query: startQuery, file: startUpload });
    expect([startPreview.applied, startPreview.totals.create, startPreview.totals.master]).toEqual([false, 1, '12.5']);
    const startImported = await call('post', '/settlements/start/import', { query: { ...startQuery, dryRun: '0' }, file: startUpload, labelId: zero.id });
    expect(startImported.result.ids).toHaveLength(1);
    await call('get', '/settlements/admission', { query: { label: zero.id } });
    const startList = await call('get', '/settlements/start', { query: { label: zero.id } });
    expect(startList.totals.starts).toBe(1);
    await call('get', '/settlements/start', { query: { active: 'false' } });
    const startOff = await call('post', '/settlements/start/:id/deactivate', { params: { id: startImported.result.ids[0] as string }, body: { reason: 'contract' } });
    expect(startOff.active).toBe(false);
    // the cuts (D-198): create, list, state, change, delete
    const cut = await call('post', '/settlements/cuts', { body: { labelId: zero.id, name: 'Contract cut', cutDate: '2026-07-15' } });
    expect(cut.masterTo).toBe('2026-07-01');
    expect((await call('get', '/settlements/cuts', { query: { label: zero.id } })).items).toHaveLength(1);
    const cutState = await call('get', '/settlements/cuts/:id/state', { params: { id: cut.id }, query: { all: 'true' } });
    expect(cutState.cut.id).toBe(cut.id);
    expect((await call('patch', '/settlements/cuts/:id', { params: { id: cut.id }, body: { name: 'Contract cut 2' } })).name).toBe('Contract cut 2');
    expect((await call('post', '/settlements/cuts/:id/delete', { params: { id: cut.id } })).id).toBe(cut.id);
    await call('get', '/settlements/operations');
    await call('get', '/settlements/operations', { query: { label: zero.id } });
    const needing = await call('get', '/settlements/operations', {
      query: { ownerId: owner.id, meaning: 'payout', direction: 'out', needsProof: 'true', active: 'true', from: '2000-01-01', to: '2100-01-01' },
    });
    expect(Array.isArray(needing)).toBe(true);
    // the stored kind and the label source (D-173); `meaning` stays the alias
    const deductions = await call('get', '/settlements/operations', { query: { kind: 'deduction', labelSource: 'operator' } });
    expect(deductions.map((o: { id: string }) => o.id)).toContain(deduction.id);

    await call('post', '/owners/merge', {
      body: { fromId: other.id, intoId: owner.id, reason: 'same person' },
    });

    // advertising expenses (D-156): a batch, the list with the allocation, the summary, a percent change, a rollback;
    // every record carries its payer (D-169)
    const adRefused = (await R.post('/api/v1/ads').set('X-Operator', OPERATOR).send({ items: [{ isrc: I1, month: '2026-07', amount: '1' }] }))
      .body as { error: { code: string; message: string } };
    expect([adRefused.error.code, adRefused.error.message.startsWith('Item 1: ')]).toEqual(['label_required', true]);
    const ads = await call('post', '/ads', {
      body: {
        items: [
          { isrc: I1, month: '2026-07', amount: '12.50', recoveryPercent: '50', externalRef: 'contract-ad-1', labelId: zero.id },
          { month: '2026-07', amount: '3', artistId: a1.id, scope: 'any', labelId: zero.id },
        ],
      },
      labelId: zero.id, // the one label of the items
    });
    expect(ads.created).toHaveLength(2);
    const adList = await call('get', '/ads', { query: { isrc: I1, limit: '10' } });
    expect(adList.items[0].allocation.status).toBe('allocated');
    const adSummary = await call('get', '/ads/summary', { query: { from: '2026-01', to: '2026-12' } });
    expect(adSummary.totals.count).toBe(2);
    await call('get', '/ads', { query: { label: zero.id } });
    await call('get', '/ads/summary', { query: { label: zero.id } });
    const oneAd = await call('get', '/ads/:id', { params: { id: ads.created[0].id } });
    expect(oneAd.allocation.isrc).toBe(I1);
    const patched = await call('patch', '/ads/:id', { params: { id: ads.created[0].id }, body: { recoveryPercent: '0' } });
    expect(patched.recoveryPercent).toBe('0');
    const echoPayer = (labelList as unknown as { id: string; name: string }[]).find((l) => l.name === 'Echo8') as { id: string };
    const repaid = await call('patch', '/ads/:id', { params: { id: ads.created[0].id }, body: { labelId: echoPayer.id }, labelId: echoPayer.id });
    expect(repaid.labelId).toBe(echoPayer.id);
    await call('post', '/ads/:id/deactivate', { params: { id: ads.created[1].id }, body: { reason: 'contract test' }, labelId: zero.id });
    await call('get', '/owners/:id/balance', { params: { id: owner.id } });

    // the trail of one entity: the merge, newest first, with ids and no free text
    const trail = await call('get', '/audit', { query: { entityId: owner.id, limit: '3' } });
    expect(trail.items[0]).toMatchObject({ method: 'POST', route: '/owners/merge', operator: ORG_OPERATOR });
    expect(trail.items[0].entityIds).toEqual(expect.arrayContaining([other.id, owner.id]));
    expect(trail.items[0].summary.body).toEqual({}); // the free-text reason is not kept (D-150)
    expect(trail.items.length).toBeLessThanOrEqual(3);
    // under a label: strictly the rows recorded under it (D-169)
    const underZero = await call('get', '/audit', { query: { label: zero.id, limit: '500' } });
    expect(underZero.items.length).toBeGreaterThan(5);
    expect(new Set(underZero.items.map((i: { labelId: string | null }) => i.labelId))).toEqual(new Set([zero.id]));
  });

  it('a write without the X-Operator header is refused and leaves no trace', async () => {
    const before = await R.get('/api/v1/audit').query({ limit: '500' }).expect(200);
    for (const header of [undefined, '', '   ', 'x'.repeat(201)]) {
      let req = R.post('/api/v1/owners');
      if (header !== undefined) req = req.set('X-Operator', header);
      const res = await req.send({ name: 'No Operator Synthetic', kind: 'person' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatchObject({ code: 'operator_required', statusCode: 400 });
    }
    const after = await R.get('/api/v1/audit').query({ limit: '500' }).expect(200);
    expect(after.body.items.length).toBe(before.body.items.length);
    const owners = await R.get('/api/v1/owners').expect(200);
    expect(JSON.stringify(owners.body)).not.toContain('No Operator Synthetic');
  });

  it('the scenario touched every operation of the contract', async () => {
    const missing = API_OPERATIONS.map(operationKey).filter((k) => !covered.has(k));
    expect(missing).toEqual([]);
  });

  it.runIf(mode === 'off')('the contract lists exactly the routes Express has', async () => {
    const real = expressRoutes(app)
      .filter((r) => r !== 'GET /openapi.json')
      .sort();
    const documented = API_OPERATIONS.map(operationKey).sort();
    expect(real).toEqual(documented);
  });

  it.runIf(mode === 'off')('serves the OpenAPI document with every operation and the Swagger UI', async () => {
    const doc = await request(app).get('/api/v1/openapi.json').expect(200);
    expect(doc.body.openapi).toBe('3.1.0');
    const built = buildOpenApiDocument();
    const count = (d: { paths?: Record<string, object> }) =>
      Object.values(d.paths ?? {}).reduce((n: number, p) => n + Object.keys(p).length, 0);
    expect(count(doc.body)).toBe(API_OPERATIONS.length);
    expect(count(built)).toBe(API_OPERATIONS.length);
    expect(doc.body.paths['/owners/{id}/balance'].get.parameters.length).toBeGreaterThan(1);
    const header = (
      doc.body.paths['/owners'].post.parameters as { name: string; in: string; required: boolean }[]
    ).find((p) => p.in === 'header');
    expect(header).toMatchObject({ name: 'X-Operator', required: true });
    expect(doc.body.paths['/health'].get.parameters ?? []).toEqual([]);
    expect((doc.body.paths['/owners'].get.parameters as { name: string }[]).map((p) => p.name)).toEqual(['label', 'limit', 'offset', 'X-Org']); // D-168, D-170, D-177
    // D-170: the two ways in, X-Org on the operations of an organization, X-Operator exactly on the non-public writes
    expect(doc.body.components.securitySchemes).toEqual({
      session: { type: 'apiKey', in: 'cookie', name: 'erp_session' },
      systemKey: { type: 'apiKey', in: 'header', name: 'X-System-Key' },
      readToken: { type: 'http', scheme: 'bearer' }, // D-177
    });
    for (const op of API_OPERATIONS) {
      const p = doc.body.paths[op.path.replace(/:([A-Za-z]+)/g, '{$1}')][op.method] as {
        parameters?: { name: string; in: string; required?: boolean }[];
        security: Record<string, string[]>[];
        responses: Record<string, unknown>;
      };
      const headers = (p.parameters ?? []).filter((x) => x.in === 'header');
      const key = operationKey(op);
      expect(headers.some((h) => h.name === 'X-Operator' && h.required), `${key} X-Operator`).toBe(
        op.method !== 'get' && op.access !== 'public',
      );
      expect(headers.some((h) => h.name === 'X-Org' && !h.required), `${key} X-Org`).toBe(op.access === 'org');
      expect(p.security.flatMap((x) => Object.keys(x)).sort(), `${key} security`).toEqual(
        [
          ...{ public: [], user: ['session'], system: ['session', 'systemKey'], org: ['session', 'systemKey'] }[op.access],
          ...(readsWithToken(op) ? ['readToken'] : []),
        ].sort(),
      );
      expect(Object.keys(p.responses).includes('401'), `${key} 401`).toBe(op.access !== 'public');
      // D-171: the right of the operation
      expect((p as { 'x-ability'?: unknown })['x-ability'], `${key} x-ability`).toEqual(op.ability);
    }
    expect(API_OPERATIONS.filter((o) => o.access === 'public').map(operationKey).sort()).toEqual([
      'GET /health',
      'POST /auth/login',
      'POST /auth/logout',
    ]);
    const ui = await request(app).get('/api/v1/docs/').expect(200);
    expect(ui.text).toContain('swagger');
  });

  it.runIf(mode === 'on')('a label manager: every operation answers as the frozen literal; another label 403, none 400 (D-171)', async () => {
    const labels = (await R.get('/api/v1/labels').expect(200)).body as { id: string; name: string; kind: string }[];
    const mine = labels.find((l) => l.name === '0to8')?.id as string; // A: the manager's label
    const other = labels.find((l) => l.name === 'Echo8')?.id as string; // B: a label of the organization, not theirs
    const login = `contract-mgr-${suffix}`;
    await createAuthService((await testStack()).db).createUser({
      login,
      password: PASSWORD,
      orgId,
      role: 'label_manager',
      labelIds: [mine],
      createdBy: 'tests',
    });
    const cookie = sessionCookieOf(await request(app).post('/api/v1/auth/login').send({ login, password: PASSWORD }).expect(200));
    const me = (await request(app).get('/api/v1/auth/me').set('Cookie', cookie).expect(200)).body as {
      role: string;
      allLabels: boolean;
      labels: { id: string }[];
      abilities: string[];
    };
    expect([me.role, me.allLabels, me.labels.map((l) => l.id)]).toEqual(['label_manager', false, [mine]]);
    expect(me.abilities.filter((k) => MANAGER_ANSWER[k] !== undefined).sort()).toEqual(
      Object.keys(MANAGER_ANSWER).filter((k) => MANAGER_ANSWER[k] !== 'x').sort(),
    );

    /** The operation as the manager, with the label `label` in the query and the body (or none). */
    const asManager = (o: ApiOperation, label: string | undefined) => {
      const url = '/api/v1' + o.path.replace(/:([A-Za-z]+)/g, 'contract-missing');
      let t = request(app)[o.method](url).set('Cookie', cookie);
      if (o.method !== 'get') t = t.set('X-Operator', OPERATOR);
      if (label) t = t.query({ label });
      if (o.method === 'get') return t;
      return t.send(label ? { labelId: label, items: [{ labelId: label }] } : {});
    };
    const answer = (res: { status: number; body: { error?: { code?: string } } }) => `${res.status} ${res.body.error?.code ?? ''}`.trim();
    for (const o of API_OPERATIONS.filter(isOrgOperation)) {
      const key = operationKey(o);
      const expected = MANAGER_ANSWER[key];
      const withMine = answer(await asManager(o, mine));
      const withNone = answer(await asManager(o, undefined));
      const withOther = answer(await asManager(o, other));
      if (expected === 'x') {
        expect([withMine, withNone, withOther], key).toEqual(['403 forbidden', '403 forbidden', '403 forbidden']);
        continue;
      }
      // allowed: whatever the route answers (a stub body, an unknown id), never a refusal of the right
      expect(withMine, `${key} under the manager's label`).not.toMatch(/^403|label_required/);
      if (expected === 'L') expect(withNone, `${key} without a label`).toBe('400 label_required');
      else expect(withNone, `${key} without a label`).not.toMatch(/^403|label_required/);
      expect(withOther, `${key} under another label`).toBe('403 label_forbidden');
    }
    // the record decides (the facade's Viewer): a record of the other label reads as unknown (404), a write on it is 403
    const adB = ((await R.post('/api/v1/ads').set('X-Operator', OPERATOR)
      .send({ items: [{ isrc: 'QZTST2600077', month: '2026-03', amount: '1', labelId: other }] }).expect(201)).body as { created: { id: string }[] }).created[0]?.id as string;
    const docB = ((await R.post('/api/v1/documents').set('X-Operator', OPERATOR)
      .send({ kind: 'appendix', title: 'contract doc B', requiresApproval: true, labelId: other }).expect(201)).body as { id: string }).id;
    const asMgr = (method: 'get' | 'post', path: string, body: object = {}) =>
      method === 'get' ? request(app).get(`/api/v1${path}`).set('Cookie', cookie) : request(app).post(`/api/v1${path}`).set('Cookie', cookie).set('X-Operator', OPERATOR).send(body);
    expect(answer(await asMgr('get', `/ads/${adB}`))).toBe('404 not_found');
    expect(answer(await asMgr('post', `/ads/${adB}/deactivate`, { reason: 'x' }))).toBe('403 label_forbidden');
    expect(answer(await asMgr('get', `/documents/${docB}/uses`))).toBe('404 not_found');
    expect(answer(await asMgr('post', `/documents/${docB}/attach`, { fileRef: 'dummy://x.pdf' }))).toBe('403 label_forbidden');
    // the path is matched as Express matches it: another case or a trailing slash is the same operation; none = 404
    for (const path of ['/api/v1/Owners/merge', '/api/v1/owners/merge/', '/api/v1/OVERVIEW'])
      expect(answer(await request(app)[path.endsWith('OVERVIEW') ? 'get' : 'post'](path).set('Cookie', cookie).set('X-Operator', OPERATOR).send({})), path).toBe(
        '403 forbidden',
      );
    expect(answer(await request(app).get('/api/v1/no-such-route').set('Cookie', cookie))).toBe('404 not_found');
    expect(answer(await request(app).delete('/api/v1/owners/x').set('Cookie', cookie).set('X-Operator', OPERATOR))).toBe('404 not_found');
    // a refusal leaves no audit row
    const rows = (await R.get('/api/v1/audit').query({ limit: '500' }).expect(200)).body.items as { operator: string }[];
    expect(rows.filter((r) => r.operator === login)).toEqual([]);
  });

  it.runIf(mode === 'on')('the system administrator in the organization: without a grant 403 support_required; under a write grant the users and support operations 403 forbidden (D-171)', async () => {
    const answer = (res: { status: number; body: { error?: { code?: string } } }) => `${res.status} ${res.body.error?.code ?? ''}`.trim();
    const asSystem = (o: ApiOperation) => {
      const t = request(app)[o.method]('/api/v1' + o.path.replace(/:([A-Za-z]+)/g, 'contract-missing'))
        .set('Cookie', cookies.system as string)
        .set('X-Org', orgId);
      return o.method === 'get' ? t : t.set('X-Operator', OPERATOR).send({});
    };
    const admin = API_OPERATIONS.filter((o) => /^\/(users|support)\b/.test(o.path));
    expect(admin.map(operationKey).sort()).toEqual(
      ['GET /support', 'GET /users', 'PATCH /users/:id', 'POST /support', 'POST /support/:id/revoke', 'POST /users', 'POST /users/:id/password'],
    );
    for (const o of admin) expect(answer(await asSystem(o)), operationKey(o)).toBe('403 support_required');
    const grant = await R.post('/api/v1/support').set('X-Operator', OPERATOR).send({ login: SYS_LOGIN, write: true }).expect(201);
    for (const o of admin) expect(answer(await asSystem(o)), operationKey(o)).toBe('403 forbidden');
    await R.post(`/api/v1/support/${grant.body.id as string}/revoke`).set('X-Operator', OPERATOR).expect(200);
  });

  it.runIf(mode === 'on')('access: public without a cookie, org and user without one 401, system under a user 403', async () => {
    const url = (o: ApiOperation) => '/api/v1' + o.path.replace(/:([A-Za-z]+)/g, 'x');
    for (const o of API_OPERATIONS) {
      const key = operationKey(o);
      if (o.access === 'public') continue;
      const anonymous = await request(app)[o.method](url(o)).set('X-Operator', OPERATOR).send({});
      expect([anonymous.status, anonymous.body.error?.code], `${key} without a cookie`).toEqual([401, 'unauthenticated']);
      if (o.access === 'system') {
        const asUser = await authed(request(app)[o.method](url(o)), 'org').set('X-Operator', OPERATOR).send({});
        expect([asUser.status, asUser.body.error?.code], `${key} under a user`).toEqual([403, 'forbidden']);
      }
    }
    await request(app).get('/api/v1/health').expect(200);
    await request(app).post('/api/v1/auth/logout').expect(200);
    await request(app).post('/api/v1/auth/login').send({ login: ORG_LOGIN, password: PASSWORD }).expect(200);
    await request(app).get('/api/v1/openapi.json').expect(200);
  });
});
}

contractSuite('off');
contractSuite('on');

/** The keys of an object schema (through a pipe, an optional or a default); undefined when it is not one. */
function shapeOf(t: unknown): Record<string, unknown> | undefined {
  const z = t as { shape?: Record<string, unknown>; def?: { in?: unknown; innerType?: unknown } } | undefined;
  if (z?.shape) return z.shape;
  if (z?.def?.in) return shapeOf(z.def.in);
  if (z?.def?.innerType) return shapeOf(z.def.innerType);
  return undefined;
}

/** Does the request schema of an operation carry a label (`?label=`, `body.labelId`, `body.items[].labelId`)? */
function namesLabel(o: ApiOperation): boolean {
  if (o.query && 'label' in o.query.shape) return true;
  const body = shapeOf(o.body);
  if (!body) return false;
  if ('labelId' in body) return true;
  const items = body.items as { def?: { element?: unknown } } | undefined;
  return !!shapeOf(items?.def?.element)?.labelId;
}

describe('API contract: the ability of every operation (D-171)', () => {
  it('(a) every operation but the public ones has an ability; (c) system ⇔ action system; user ⇔ self; org has one scope', () => {
    for (const o of API_OPERATIONS) {
      const key = operationKey(o);
      if (o.access === 'public') {
        expect(o.ability, key).toBeUndefined();
        continue;
      }
      expect(o.ability, key).toBeDefined();
      expect(o.ability.action === 'system', `${key} system`).toBe(o.access === 'system');
      expect(o.ability.action === 'self', `${key} self`).toBe(o.access === 'user');
      expect(o.ability.scope !== undefined, `${key} scope`).toBe(o.access === 'org');
    }
  });

  it('(b) a label scope names a label in its schema; any other operation naming one is a relabel', () => {
    for (const o of API_OPERATIONS.filter(isOrgOperation)) {
      const key = operationKey(o);
      if (o.ability.scope === 'label') expect(namesLabel(o), `${key} label scope without a label`).toBe(true);
      else if (namesLabel(o)) expect(RELABEL_OPERATIONS.has(key), `${key} names a label but is ${o.ability.scope}`).toBe(true);
    }
    for (const key of RELABEL_OPERATIONS) {
      const o = API_OPERATIONS.find((x) => operationKey(x) === key);
      expect([o?.ability?.scope, o && namesLabel(o)], key).toEqual([key === 'PATCH /ads/:id' ? 'record' : 'org', true]);
    }
  });

  it('a preview mode (D-172) only on the three imports (splits; operations, D-173; the start, D-174), with dryRun in its query; the release preview is a route of its own (D-195)', () => {
    const previews = API_OPERATIONS.filter((o) => o.preview);
    expect(previews.map(operationKey).sort()).toEqual(['POST /releases/preview', 'POST /settlements/operations/import', 'POST /settlements/start/import', 'POST /splits/import']);
    for (const o of previews.filter((x) => x.path !== '/releases/preview')) expect(o.query && 'dryRun' in o.query.shape, operationKey(o)).toBe(true);
  });

  it('(d) a GET never writes, approves, pays or administers; only reading the users, the support grants and the organization checklist is admin', () => {
    const adminReads = ['GET /support', 'GET /users', 'GET /onboarding/organization']; // D-171: the organization's users are the administrator's to see
    for (const o of API_OPERATIONS.filter((x) => x.method === 'get' && x.ability))
      expect(adminReads.includes(operationKey(o)) ? ['admin'] : ['read', 'read_money', 'self', 'system'], operationKey(o)).toContain(o.ability?.action);
  });
});
