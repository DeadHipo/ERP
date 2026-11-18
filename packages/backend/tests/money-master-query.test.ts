import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import * as R from '@erp/shared/api-responses';
import { createServerApp } from '../src/api/server-app';
import type { AuthConfig } from '../src/auth/middleware';
import { createAuthService } from '../src/auth/service';
import { createOrgFacades } from '../src/orgs/facades';
import { ACC1, ACC2, Case, I } from './helpers/golden-case';
import { TMP, writeBelieve, type TestFacade } from './helpers/fixtures';
import { testStack } from './helpers/test-sources';

// `POST /money/master/query?label=` (D-248): `masterRows` of the facade (`money-rows.test.ts` pins its money against
// the answers it replaces) as a read sent as a POST (D-246). Here the real chain: the answer of the route is the answer
// of the facade character for character, the rights are those of `GET /releases/:upc` and `GET /tracks/summary`
// (a manager under its own label), no operator, no audit row, nothing written. Synthetic data only.

const U1 = '1000000000001'; // the release of I(1), I(2), I(3): lines of both labels
const PASSWORD = 'money-master-password';
const TOKEN = randomBytes(32).toString('hex');
const SECRET = randomBytes(32).toString('hex');
const MODULE_SCHEMAS = ['owners', 'splits', 'labels', 'settlements', 'pubv2', 'links', 'audit', 'ads'];

type Body = { scope: { kind: 'release'; upc: string } | { kind: 'isrcs'; isrcs?: string[] }; grain: 'isrc' | 'month' | 'isrc,month'; period?: { from?: string; to?: string } };
type Answer = { rows: { isrc?: string; month?: string; sums: { net: string; B: string; C: string; ours: string; cByReason: Record<string, string> }; months?: { from: string; to: string; count: number } }[]; totals: { net: string }; calculatedAt: string };

describe('POST /money/master/query: the master money as rows, a read sent as a POST (D-248)', () => {
  let c: Case;
  let f: TestFacade;
  let A = '';
  let B = '';
  let off: Express;
  let on: Express;
  let admin = '';
  let manager = '';

  /** Every row of every module table and of the file registry, as one text: a read leaves it byte for byte. */
  async function state(): Promise<string> {
    const { pg } = await testStack();
    const tables = (
      await pg.pool.query<{ t: string }>(
        `SELECT quote_ident(table_schema) || '.' || quote_ident(table_name) AS t FROM information_schema.tables
          WHERE table_type = 'BASE TABLE' AND (table_schema = ANY($1) OR (table_schema = 'public' AND table_name = 'source_files')) ORDER BY 1`,
        [MODULE_SCHEMAS],
      )
    ).rows.map((r) => r.t);
    expect(tables.length).toBeGreaterThan(30);
    const out: string[] = [];
    for (const t of tables) {
      const r = await pg.pool.query<{ n: string; h: string }>(
        `SELECT count(*)::text AS n, coalesce(md5(string_agg(md5(x::text), '' ORDER BY md5(x::text))), '') AS h FROM ${t} x`,
      );
      out.push(`${t} ${r.rows[0]?.n} ${r.rows[0]?.h}`);
    }
    return out.join('\n');
  }
  const auditRows = async () => ((await request(off).get('/api/v1/audit').query({ limit: '500' }).expect(200)).body.items as unknown[]).length;
  const query = (app: Express, body: unknown, label?: string) => {
    const req = request(app).post('/api/v1/money/master/query');
    return (label === undefined ? req : req.query({ label })).send(body as object);
  };
  const answer = (res: { status: number; body: { error?: { code?: string } } }) => `${res.status} ${res.body.error?.code ?? ''}`.trim();
  /** The answer without its clock: the rows and the totals as the JSON text the route sends. */
  const text = (x: { rows: unknown; totals: unknown }) => JSON.stringify({ rows: x.rows, totals: x.totals });
  const login = async (name: string) => {
    const res = await request(on).post('/api/v1/auth/login').send({ login: name, password: PASSWORD }).expect(200);
    const pair = (res.headers['set-cookie'] as unknown as string[]).find((x) => x.startsWith('erp_session='))?.split(';')[0];
    if (!pair) throw new Error('no session cookie');
    return pair;
  };
  const RELEASE: Body = { scope: { kind: 'release', upc: U1 }, grain: 'isrc' };

  beforeAll(async () => {
    c = await Case.start();
    f = c.f;
    A = f.testLabels['0to8'];
    B = f.testLabels.Echo8;
    await c.person('PA', 'QA', 'PB');
    for (const n of [1, 2, 3]) await f.modules.owners.createTrack({ title: `Catalog ${n}`, isrc: I(n), upc: U1 });
    await c.split(I(1), [['PA', '50']]);
    await c.split(I(2), [['PA', '40'], ['QA', '10']], { doc: null }); // no document: C `split_unconfirmed`
    await c.split(I(3), [['PB', '50']]);
    // the book of A: I(1), I(2) in March and April; the book of B: I(1) and I(3) in March
    await f.ingestBelieve(writeBelieve('2026-03', [{ isrc: I(1), upc: U1, net: '100' }, { isrc: I(2), upc: U1, net: '50' }], { account: ACC1 }), A);
    await f.ingestBelieve(writeBelieve('2026-04', [{ isrc: I(1), upc: U1, net: '200' }], { account: ACC1 }), A);
    await f.ingestBelieve(
      writeBelieve('2026-03', [{ isrc: I(1), upc: U1, net: '60', labelName: 'Echo8' }, { isrc: I(3), upc: U1, net: '30', labelName: 'Echo8' }], { account: ACC2 }),
      B,
    );

    const stack = await testStack();
    const dataDir = join(TMP, `money-master-${randomUUID().slice(0, 8)}`);
    mkdirSync(dataDir, { recursive: true });
    const orgs = createOrgFacades({ stores: { db: stack.db, pool: stack.pg.pool, columnar: stack.columnar }, dataDir, payoutThresholdCents: 0 });
    const service = createAuthService(stack.db);
    const app = (config: AuthConfig) => createServerApp({ orgs, auth: { service, config } });
    off = app({ mode: 'off', defaultOrg: f.orgId, readToken: TOKEN });
    on = app({ mode: 'on', secret: SECRET, defaultOrg: f.orgId, readToken: TOKEN });
    const sfx = randomUUID().slice(0, 8);
    await service.createUser({ login: `mm-admin-${sfx}`, password: PASSWORD, orgId: f.orgId, role: 'org_admin', createdBy: 'tests' });
    await service.createUser({ login: `mm-mgr-${sfx}`, password: PASSWORD, orgId: f.orgId, role: 'label_manager', labelIds: [A], createdBy: 'tests' });
    admin = await login(`mm-admin-${sfx}`);
    manager = await login(`mm-mgr-${sfx}`);
  });

  it('the answer of the route is the answer of the facade, character for character, and fits the contract: every scope and grain, with and without a label', async () => {
    const bodies: Body[] = [
      RELEASE,
      { scope: { kind: 'release', upc: U1 }, grain: 'month' },
      { scope: { kind: 'release', upc: U1 }, grain: 'isrc,month', period: { from: '2026-03', to: '2026-03' } },
      { scope: { kind: 'isrcs', isrcs: [I(2), I(1), I(3)] }, grain: 'isrc' },
      { scope: { kind: 'isrcs', isrcs: [I(1)] }, grain: 'isrc,month', period: { from: '2026-04' } },
      { scope: { kind: 'isrcs' }, grain: 'month', period: { to: '2026-03' } },
      { scope: { kind: 'isrcs' }, grain: 'isrc' },
      { scope: { kind: 'isrcs', isrcs: [] }, grain: 'isrc' },
    ];
    let withRows = 0;
    for (const body of bodies)
      for (const label of [undefined, A, B]) {
        const res = await query(off, body, label);
        expect(answer(res), JSON.stringify([body, label])).toBe('200');
        const parsed = R.masterRowsSchema.safeParse(res.body);
        expect(parsed.success ? null : parsed.error.issues, JSON.stringify([body, label])).toBeNull();
        // the whole answer as JSON text, but for its clock
        const noClock = (json: string) => json.replace(/"calculatedAt":"[^"]+"/, '"calculatedAt":""');
        expect(noClock(JSON.stringify(res.body)), JSON.stringify([body, label])).toBe(noClock(JSON.stringify(await f.masterRows(body, label))));
        if ((res.body as Answer).rows.length > 0) withRows += 1;
      }
    expect(withRows).toBeGreaterThan(15);

    // the money itself, by hand: under «Все» I(1) is 100 + 200 of A and 60 of B; under A only its own files
    const all = (await query(off, RELEASE).expect(200)).body as Answer;
    expect(all.rows.map((r) => [r.isrc, r.sums.net, r.months])).toEqual([
      [I(1), '360', { from: '2026-03', to: '2026-04', count: 2 }],
      [I(2), '50', { from: '2026-03', to: '2026-03', count: 1 }],
      [I(3), '30', { from: '2026-03', to: '2026-03', count: 1 }],
    ]);
    expect(all.totals.net).toBe('440');
    const underA = (await query(off, RELEASE, A).expect(200)).body as Answer;
    expect(underA.rows.map((r) => [r.isrc, r.sums.net])).toEqual([[I(1), '300'], [I(2), '50']]);
    expect(Object.keys(underA.rows[1]?.sums.cByReason ?? {})).toContain('split_unconfirmed');
    const months = (await query(off, { ...RELEASE, grain: 'month' }, A).expect(200)).body as Answer;
    expect(months.rows.map((r) => [r.isrc, r.month, r.sums.net, r.months])).toEqual([[undefined, '2026-03', '150', undefined], [undefined, '2026-04', '200', undefined]]);
    // money is text: a decimal string in every sum
    for (const r of all.rows) for (const k of ['net', 'B', 'C', 'ours'] as const) expect(r.sums[k]).toMatch(/^-?\d+(\.\d+)?$/);
  });

  it('without X-Operator: 200; no audit row and no row of any module changed; with a session and a header it does not need: the same', async () => {
    const before = await state();
    const rows = await auditRows();
    const res = await query(off, RELEASE, A);
    expect(answer(res)).toBe('200');
    expect(res.headers['x-audit']).toBeUndefined();
    expect(text((await query(on, RELEASE, A).set('Cookie', admin).expect(200)).body as Answer)).toBe(text(res.body as Answer));
    await query(off, { scope: { kind: 'isrcs', isrcs: [I(1)] }, grain: 'isrc,month' }).set('X-Operator', 'tests').expect(200);
    await query(off, { scope: { kind: 'isrcs' }, grain: 'month' }, B).expect(200);
    expect(await auditRows()).toBe(rows);
    expect(await state()).toBe(before);
  });

  it('a write beside it still needs the operator and leaves its row (D-140)', async () => {
    const rows = await auditRows();
    expect(answer(await request(off).post('/api/v1/tracks').send({ title: 'No operator', isrc: I(40), upc: U1 }))).toBe('400 operator_required');
    await request(off).post('/api/v1/tracks').set('X-Operator', 'tests').send({ title: 'With operator', isrc: I(40), upc: U1 }).expect(201);
    expect(await auditRows()).toBe(rows + 1);
  });

  it('the body: at most 5000 ISRCs of at most 32 characters, the format of an ISRC, a known grain and scope, months as YYYY-MM', async () => {
    const many = (n: number) => Array.from({ length: n }, (_v, i) => `QZTST26${String(i + 10000).padStart(5, '0')}`);
    const isrcs = (list: unknown, more: object = {}) => ({ scope: { kind: 'isrcs', isrcs: list }, grain: 'isrc', ...more });
    expect(answer(await query(off, isrcs(many(5001))))).toBe('400 validation_error');
    const full = await query(off, isrcs(many(5000)));
    expect([answer(full), (full.body as Answer).rows]).toEqual(['200', []]);
    expect(answer(await query(off, isrcs('QZTST2600001')))).toBe('400 validation_error');
    expect(answer(await query(off, isrcs([I(1), 'not-an-isrc'])))).toBe('400 validation_error');
    expect(answer(await query(off, isrcs([`${I(1)}${' '.repeat(21)}`])))).toBe('400 validation_error');
    expect(answer(await query(off, isrcs([`${I(1)}${' '.repeat(20)}`])))).toBe('200');
    expect(answer(await request(off).post('/api/v1/money/master/query').send())).toBe('400 validation_error');
    expect(answer(await query(off, { scope: { kind: 'isrcs', isrcs: [I(1)] } }))).toBe('400 validation_error'); // no grain
    expect(answer(await query(off, { grain: 'isrc' }))).toBe('400 validation_error'); // no scope
    expect(answer(await query(off, { ...RELEASE, grain: 'upc' }))).toBe('400 validation_error');
    expect(answer(await query(off, { scope: { kind: 'label', id: A }, grain: 'isrc' }))).toBe('400 validation_error');
    expect(answer(await query(off, { scope: { kind: 'release' }, grain: 'isrc' }))).toBe('400 validation_error'); // a release without its UPC
    expect(answer(await query(off, { scope: { kind: 'release', upc: '' }, grain: 'isrc' }))).toBe('400 validation_error');
    expect(answer(await query(off, { ...RELEASE, period: { from: '2026-3' } }))).toBe('400 validation_error');
    expect(answer(await query(off, { ...RELEASE, period: { to: '2026-13' } }))).toBe('400 validation_error');
    expect(answer(await query(off, { ...RELEASE, period: '2026-03' }))).toBe('400 validation_error');
    // a period that ends before it starts is an empty period, as on the other period reads: no rows, not an error
    const empty = await query(off, { ...RELEASE, period: { from: '2026-04', to: '2026-03' } });
    expect([answer(empty), text(empty.body as Answer)]).toEqual(['200', JSON.stringify({ rows: [], totals: { net: '0', B: '0', C: '0', ours: '0', cByReason: {} } })]);
    // a repeated ISRC counts once, in any spelling; an unknown one and an unknown release have no row
    const repeated = (await query(off, isrcs([I(1), I(1), I(1).toLowerCase(), `${I(1).slice(0, 2)}-${I(1).slice(2, 5)}-${I(1).slice(5)}`, 'QZTST2699999'])).expect(200)).body as Answer;
    expect(repeated.rows.map((r) => r.isrc)).toEqual([I(1)]);
    expect(text(repeated)).toBe(text((await query(off, isrcs([I(1)])).expect(200)).body as Answer));
    expect(((await query(off, { scope: { kind: 'release', upc: '9999999999999' }, grain: 'isrc' }).expect(200)).body as Answer).rows).toEqual([]);
    // the label of the query is an own label of the organization
    expect(answer(await query(off, RELEASE, randomUUID()))).toBe('404 not_found');
  });

  it('a manager: its own book 200 (the answer of the administrator under that label); no label 400 label_required; another label 403 label_forbidden', async () => {
    for (const body of [RELEASE, { scope: { kind: 'isrcs', isrcs: [I(1), I(2), I(3)] }, grain: 'isrc,month' }, { scope: { kind: 'isrcs' }, grain: 'month' }] as Body[]) {
      const own = await query(on, body, A).set('Cookie', manager);
      expect(answer(own)).toBe('200');
      expect(text(own.body as Answer)).toBe(text((await query(on, body, A).set('Cookie', admin).expect(200)).body as Answer));
      expect((own.body as Answer).rows.length).toBeGreaterThan(0);
      // nothing of the other book: I(3) earns only in the files of B
      expect(JSON.stringify(own.body)).not.toContain(I(3));
      expect(answer(await query(on, body).set('Cookie', manager))).toBe('400 label_required');
      expect(answer(await query(on, body, B).set('Cookie', manager))).toBe('403 label_forbidden');
    }
    // the right is asked before the body is read: a refused manager learns nothing from a wrong body either
    expect(answer(await query(on, { grain: 'x' }, B).set('Cookie', manager))).toBe('403 label_forbidden');
    // the administrator reads every label and «Все»
    for (const label of [undefined, A, B]) expect(answer(await query(on, RELEASE, label).set('Cookie', admin))).toBe('200');
  });

  it('the label is named in the query only: a key the body does not have is 400, so a label in the body never stands for ?label=', async () => {
    // the label check of the chain counts `body.labelId` and `body.items[].labelId` as labels of the request; the route
    // reads only `?label=`. Were the extra key ignored, a manager of A would pass the check and get every book.
    const noMoney = (res: { body: unknown }) => expect(JSON.stringify(res.body)).not.toMatch(/"rows"|"totals"|"net"|"sums"|"cByReason"/);
    const bodies: object[] = [
      { ...RELEASE, labelId: A },
      { ...RELEASE, items: [{ labelId: A }] },
      { scope: { kind: 'release', upc: U1, labelId: A }, grain: 'isrc', labelId: A },
      { scope: { kind: 'isrcs', isrcs: [I(1)], upc: U1 }, grain: 'isrc', labelId: A },
      { ...RELEASE, period: { from: '2026-03', labelId: A }, labelId: A },
      { ...RELEASE, period: { basis: 'sales' }, labelId: A },
    ];
    for (const body of bodies) {
      const res = await query(on, body).set('Cookie', manager);
      expect(answer(res), JSON.stringify(body)).toBe('400 validation_error');
      noMoney(res);
      // with its own label in the query too: still the body is refused
      const named = await query(on, body, A).set('Cookie', manager);
      expect(answer(named), JSON.stringify(body)).toBe('400 validation_error');
      noMoney(named);
      // the administrator, and the chain without a login: the same refusal
      expect(answer(await query(on, body).set('Cookie', admin)), JSON.stringify(body)).toBe('400 validation_error');
      expect(answer(await query(off, body)), JSON.stringify(body)).toBe('400 validation_error');
    }
    // a nested extra key without any label: the manager has named no label at all
    expect(answer(await query(on, { scope: { kind: 'release', upc: U1, extra: 1 }, grain: 'isrc' }).set('Cookie', manager))).toBe('400 label_required');
    expect(answer(await query(on, { scope: { kind: 'release', upc: U1, extra: 1 }, grain: 'isrc' }, A).set('Cookie', manager))).toBe('400 validation_error');
    // another label in the body is refused by the right, before the body is read
    expect(answer(await query(on, { ...RELEASE, labelId: B }).set('Cookie', manager))).toBe('403 label_forbidden');
  });

  it('the chain stays: no session 401; another site 403 csrf (originGuard on every POST); the read token reads and still writes nothing', async () => {
    expect(answer(await query(on, RELEASE))).toBe('401 unauthenticated');
    expect(answer(await query(on, RELEASE).set('Cookie', admin).set('Origin', 'https://other.example'))).toBe('403 csrf');
    expect(answer(await query(on, RELEASE).set('Cookie', admin).set('Sec-Fetch-Site', 'cross-site'))).toBe('403 csrf');
    const rows = await auditRows();
    for (const app of [on, off])
      for (const label of [undefined, A]) {
        const res = await query(app, RELEASE, label).set('Authorization', `Bearer ${TOKEN}`);
        expect(answer(res)).toBe('200');
        expect(text(res.body as Answer)).toBe(text((await query(off, RELEASE, label).expect(200)).body as Answer));
      }
    expect(await auditRows()).toBe(rows);
    expect(answer(await request(on).post('/api/v1/tracks').set('Authorization', `Bearer ${TOKEN}`).set('X-Operator', 'tests').send({ title: 'x' }))).toBe('403 forbidden');
  });
});
