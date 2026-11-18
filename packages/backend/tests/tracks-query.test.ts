import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createServerApp } from '../src/api/server-app';
import type { AuthConfig } from '../src/auth/middleware';
import { createAuthService } from '../src/auth/service';
import { createOrgFacades } from '../src/orgs/facades';
import { labelsViewer } from '../src/facade/viewer';
import { ACC1, ACC2, Case, I } from './helpers/golden-case';
import { TMP, writeBelieve, type TestFacade } from './helpers/fixtures';
import { testStack } from './helpers/test-sources';

// `POST /tracks/query` (D-246): the track directory of the facade (D-245) as a read sent as a POST. No operator, no
// audit row, nothing written; the visibility per field is the facade's (`tracks.test.ts`), here it is checked on the
// real chain with a manager's session. Synthetic data only.

const U1 = '1000000000001'; // the release of I(1), I(2): label A
const U2 = '1000000000002'; // the release of I(3): label B
const PASSWORD = 'tracks-query-password';
const TOKEN = randomBytes(32).toString('hex');
const SECRET = randomBytes(32).toString('hex');
const MODULE_SCHEMAS = ['owners', 'splits', 'labels', 'settlements', 'pubv2', 'links', 'audit', 'ads'];

type Directory = {
  tracks: Record<string, { isrc: string; catalogTitle: string | null; reportTitle: string | null; meta: { title: string | null } | null; catalogLabel: unknown; upcs: string[] | null; artists: string[] | null }>;
  releases: Record<string, unknown>;
  artists: Record<string, { id: string; pseudonym: string }>;
};

describe('POST /tracks/query: a read sent as a POST (D-246)', () => {
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
  const query = (app: Express, isrcs: unknown) => request(app).post('/api/v1/tracks/query').send({ isrcs });
  const answer = (res: { status: number; body: { error?: { code?: string } } }) => `${res.status} ${res.body.error?.code ?? ''}`.trim();
  const login = async (name: string) => {
    const res = await request(on).post('/api/v1/auth/login').send({ login: name, password: PASSWORD }).expect(200);
    const pair = (res.headers['set-cookie'] as unknown as string[]).find((x) => x.startsWith('erp_session='))?.split(';')[0];
    if (!pair) throw new Error('no session cookie');
    return pair;
  };

  beforeAll(async () => {
    c = await Case.start();
    f = c.f;
    A = f.testLabels['0to8'];
    B = f.testLabels.Echo8;
    await c.person('PA', 'QA', 'PB');
    await f.modules.owners.createTrack({ title: 'Catalog one', isrc: I(1), upc: U1 });
    await f.modules.owners.createTrack({ title: 'Catalog two', isrc: I(2), upc: U1 });
    await f.modules.owners.createTrack({ title: 'Catalog three', isrc: I(3), upc: U2 });
    await c.split(I(1), [['PA', '50']]);
    await c.split(I(2), [['PA', '40'], ['QA', '10']]);
    await c.split(I(3), [['PB', '50']]);
    await f.ingestBelieve(
      writeBelieve('2026-03', [{ isrc: I(1), upc: U1, net: '100', trackTitle: 'Report one' }, { isrc: I(2), upc: U1, net: '100', trackTitle: 'Report two' }], { account: ACC1 }),
      A,
    );
    await f.ingestBelieve(writeBelieve('2026-03', [{ isrc: I(3), upc: U2, net: '100', trackTitle: 'Report three', labelName: 'Echo8' }], { account: ACC2 }), B);
    await f.setTrackMeta(I(3), { title: 'Meta three' }, 'op1');
    await f.setTrackLabel(I(3), { labelId: B, from: '2026-01-01' });

    const stack = await testStack();
    const dataDir = join(TMP, `tracks-query-${randomUUID().slice(0, 8)}`);
    mkdirSync(dataDir, { recursive: true });
    const orgs = createOrgFacades({ stores: { db: stack.db, pool: stack.pg.pool, columnar: stack.columnar }, dataDir, payoutThresholdCents: 0 });
    const service = createAuthService(stack.db);
    const app = (config: AuthConfig) => createServerApp({ orgs, auth: { service, config } });
    off = app({ mode: 'off', defaultOrg: f.orgId, readToken: TOKEN });
    on = app({ mode: 'on', secret: SECRET, defaultOrg: f.orgId, readToken: TOKEN });
    const sfx = randomUUID().slice(0, 8);
    await service.createUser({ login: `tq-admin-${sfx}`, password: PASSWORD, orgId: f.orgId, role: 'org_admin', createdBy: 'tests' });
    await service.createUser({ login: `tq-mgr-${sfx}`, password: PASSWORD, orgId: f.orgId, role: 'label_manager', labelIds: [A], createdBy: 'tests' });
    admin = await login(`tq-admin-${sfx}`);
    manager = await login(`tq-mgr-${sfx}`);
  });

  it('without X-Operator: 200, the answer of the facade; no audit row and no row of any module changed', async () => {
    const before = await state();
    const rows = await auditRows();
    const res = await query(off, [I(1), I(2), I(3)]);
    expect(answer(res)).toBe('200');
    expect(res.headers['x-audit']).toBeUndefined();
    expect(JSON.stringify(res.body)).toBe(JSON.stringify(await f.tracksOf([I(1), I(2), I(3)])));
    const body = res.body as Directory;
    expect(Object.keys(body.tracks).sort()).toEqual([I(1), I(2), I(3)]);
    expect(Object.keys(body.releases).sort()).toEqual([U1, U2]);
    expect(Object.keys(body.artists).sort()).toEqual([c.id('PA'), c.id('QA'), c.id('PB')].sort());
    // with a session, and with a header it does not need: the same, still no row
    expect(JSON.stringify((await query(on, [I(1), I(2), I(3)]).set('Cookie', admin).expect(200)).body)).toBe(JSON.stringify(res.body));
    await query(off, [I(1)]).set('X-Operator', 'tests').expect(200);
    expect(await auditRows()).toBe(rows);
    expect(await state()).toBe(before);
  });

  it('a write beside it still needs the operator and leaves its row (D-140)', async () => {
    const rows = await auditRows();
    expect(answer(await request(off).post('/api/v1/tracks').send({ title: 'No operator', isrc: I(40), upc: U1 }))).toBe('400 operator_required');
    await request(off).post('/api/v1/tracks').set('X-Operator', 'tests').send({ title: 'With operator', isrc: I(40), upc: U1 }).expect(201);
    expect(await auditRows()).toBe(rows + 1);
  });

  it('the body: 1 to 1000 ISRCs, the format of an ISRC, a repeated one once, an unknown one absent', async () => {
    const many = (n: number) => Array.from({ length: n }, (_v, i) => `QZTST27${String(i).padStart(5, '0')}`);
    expect(answer(await query(off, many(1001)))).toBe('400 validation_error');
    expect(answer(await query(off, []))).toBe('400 validation_error');
    expect(answer(await query(off, undefined))).toBe('400 validation_error');
    expect(answer(await query(off, 'QZTST2600001'))).toBe('400 validation_error');
    expect(answer(await query(off, [I(1), 'not-an-isrc']))).toBe('400 validation_error');
    // an element is at most 32 characters (the schema); a string of spaces around an ISRC that long never reaches the facade
    expect(answer(await query(off, [`${I(1)}${' '.repeat(21)}`]))).toBe('400 validation_error');
    expect(answer(await query(off, [`${I(1)}${' '.repeat(20)}`]))).toBe('200');
    expect(answer(await request(off).post('/api/v1/tracks/query').send())).toBe('400 validation_error');
    const full = await query(off, many(1000));
    expect([answer(full), full.body]).toEqual(['200', { tracks: {}, releases: {}, artists: {} }]);
    const repeated = (await query(off, [I(1), I(1), I(1).toLowerCase(), `${I(1).slice(0, 2)}-${I(1).slice(2, 5)}-${I(1).slice(5)}`, 'QZTST2699999']).expect(200)).body as Directory;
    expect(Object.keys(repeated.tracks)).toEqual([I(1)]);
    expect(JSON.stringify(repeated)).toBe(JSON.stringify((await query(off, [I(1)]).expect(200)).body));
  });

  it('a manager on the ISRCs of its own label: 200 and the answer of every label for those ISRCs', async () => {
    const res = await query(on, [I(1), I(2)]).set('Cookie', manager);
    expect(answer(res)).toBe('200');
    const body = res.body as Directory;
    expect(JSON.stringify(body)).toBe(JSON.stringify((await query(on, [I(1), I(2)]).set('Cookie', admin).expect(200)).body));
    expect(body.tracks[I(1)]).toMatchObject({ catalogTitle: 'Catalog one', reportTitle: 'Report one', upcs: [U1], artists: [c.id('PA')] });
    expect(Object.keys(body.releases)).toEqual([U1]);
    expect(Object.keys(body.artists).sort()).toEqual([c.id('PA'), c.id('QA')].sort());
  });

  it('a manager on an ISRC of another label: upcs, artists and reportTitle are null, meta and catalogTitle stay; its UPC and pseudonym reach no map', async () => {
    const res = await query(on, [I(1), I(3)]).set('Cookie', manager);
    expect(answer(res)).toBe('200');
    const body = res.body as Directory;
    expect(JSON.stringify(body)).toBe(JSON.stringify(await f.tracksOf([I(1), I(3)], labelsViewer([A]))));
    const other = body.tracks[I(3)];
    expect([other?.upcs, other?.artists, other?.reportTitle]).toEqual([null, null, null]);
    expect([other?.catalogTitle, other?.meta?.title]).toEqual(['Catalog three', 'Meta three']);
    expect(other?.catalogLabel).toEqual({ id: B, name: 'Echo8' });
    expect(Object.keys(body.releases)).toEqual([U1]);
    expect(Object.keys(body.artists)).toEqual([c.id('PA')]);
    expect(JSON.stringify(body)).not.toContain(U2);
    expect(JSON.stringify(body)).not.toContain(c.id('PB'));
    // the administrator sees both sides
    const whole = (await query(on, [I(3)]).set('Cookie', admin).expect(200)).body as Directory;
    expect(whole.tracks[I(3)]).toMatchObject({ reportTitle: 'Report three', upcs: [U2], artists: [c.id('PB')] });
    // the label of the request is still the manager's own (labelGuard): another one is refused
    expect(answer(await query(on, [I(3)]).query({ label: B }).set('Cookie', manager))).toBe('403 label_forbidden');
  });

  it('the chain stays: no session 401; another site 403 csrf (originGuard on every POST); the read token reads', async () => {
    expect(answer(await query(on, [I(1)]))).toBe('401 unauthenticated');
    expect(answer(await query(on, [I(1)]).set('Cookie', admin).set('Origin', 'https://other.example'))).toBe('403 csrf');
    expect(answer(await query(on, [I(1)]).set('Cookie', admin).set('Sec-Fetch-Site', 'cross-site'))).toBe('403 csrf');
    for (const app of [on, off]) {
      const res = await query(app, [I(1), I(3)]).set('Authorization', `Bearer ${TOKEN}`);
      expect(answer(res)).toBe('200');
      expect(Object.keys((res.body as Directory).tracks).sort()).toEqual([I(1), I(3)]);
    }
    // the token still writes nothing: a write beside it is refused
    expect(answer(await request(on).post('/api/v1/tracks').set('Authorization', `Bearer ${TOKEN}`).set('X-Operator', 'tests').send({ title: 'x' }))).toBe('403 forbidden');
  });
});
