import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServerApp } from '../src/api/server-app';
import { API_OPERATIONS, operationKey } from '../src/api/operations';
import { createAuthService } from '../src/auth/service';
import { createOrgFacades } from '../src/orgs/facades';
import { openFacade } from '../src/facade';
import { calculate } from '../src/facade/calculation';
import { createSourceFilesRegistry, createSourcesService } from '../src/modules/sources';
import { orgScope } from '../src/shared/org-scope';
import { createOrgsService } from '../src/orgs/service';
import { approvedAppendix, confirmedOwner, writeB17, writeBelieve } from './helpers/fixtures';
import { testStack } from './helpers/test-sources';
import { TMP } from './helpers/tmp-root';

// The organization boundary (stage 2, D-170): every table of the modules carries org_id, every repository statement
// filters by it through the one helper (shared/org-scope.ts), and two organizations in one database never see each
// other's rows. Synthetic data only.

const SRC = join(process.cwd(), 'src');
const MODULES = ['owners', 'splits', 'labels', 'settlements', 'publishing', 'pubv2', 'links', 'audit', 'ads'];
const REPOSITORIES = [
  ...MODULES.map((m) => join(SRC, 'modules', m, 'repository.ts')),
  join(SRC, 'modules', 'sources', 'registry.ts'),
];
const read = (f: string) => readFileSync(f, 'utf8');

/** The string literals (backtick or quote) that are the first argument of `name(` / `name<…>(` calls. */
function sqlLiterals(text: string, names: string[]): string[] {
  const out: string[] = [];
  const re = new RegExp(`\\b(?:${names.join('|')})(?:<[^>(]*>)?\\((?:\\s|//[^\\n]*\\n)*([\`'])`, 'g');
  for (const m of text.matchAll(re)) {
    const quote = m[1] as string;
    const start = (m.index ?? 0) + m[0].length;
    const end = text.indexOf(quote, start);
    out.push(text.slice(start, end));
  }
  return out;
}

describe('organization scope: static checks (D-170)', () => {
  it('every table of the module schemas and public.source_files has org_id NOT NULL; the grouped B17 view is keyed by org_id first', async () => {
    const { pg } = await testStack();
    const tables = (
      await pg.pool.query<{ t: string; nullable: string | null }>(
        `SELECT format('%s.%s', t.schemaname, t.tablename) AS t, c.is_nullable AS nullable
         FROM pg_tables t
         LEFT JOIN information_schema.columns c
           ON c.table_schema = t.schemaname AND c.table_name = t.tablename AND c.column_name = 'org_id'
         WHERE t.schemaname = ANY($1) OR (t.schemaname = 'public' AND t.tablename = 'source_files')`,
        [MODULES],
      )
    ).rows;
    expect(tables.length).toBe(41); // + owners.track_labels, owners.releases (0018, D-172), settlements.opening_balances (0020, D-174), settlements.payees / holds / payout_answers (0021, D-176)
    for (const r of tables) expect(r.nullable, `${r.t}.org_id`).toBe('NO');

    const def = (
      await pg.pool.query<{ d: string }>(`SELECT pg_get_viewdef('publishing.pub_lines_by_key'::regclass) AS d`)
    ).rows[0]?.d as string;
    expect(def).toMatch(/SELECT\s+s\.org_id,/);
    expect(def).toMatch(/GROUP BY\s+s\.org_id,/);
    const index = (
      await pg.pool.query<{ d: string }>(
        `SELECT indexdef AS d FROM pg_indexes WHERE schemaname = 'publishing' AND indexname = 'pub_lines_by_key_order'`,
      )
    ).rows[0]?.d as string;
    expect(index).toMatch(/\(org_id, period COLLATE "C"/);
  });

  it('every s.table of the module schemas declares orgId notNull()', () => {
    for (const m of MODULES) {
      const schema = read(join(SRC, 'modules', m, 'schema.ts'));
      const blocks = schema.split(/s\.table\(/).slice(1);
      expect(blocks.length, m).toBeGreaterThan(0);
      for (const b of blocks) expect(b.slice(0, 400), `${m}: ${b.slice(0, 40)}`).toMatch(/orgId: text\('org_id'\)\.notNull\(\)/);
    }
  });

  it('every repository statement goes through the helper: orgWhere, orgRow(s), orgQuery with org_id = $1', () => {
    const tableNames = new Set<string>(['source_files']);
    for (const m of MODULES)
      for (const x of read(join(SRC, 'modules', m, 'schema.ts')).matchAll(/s\.table\(\s*'([a-z_]+)'/g))
        tableNames.add(`${m}.${x[1] as string}`);

    for (const file of REPOSITORIES) {
      const text = read(file);
      // the drizzle chains: every .from / .update / .delete carries orgWhere(org, …) before the next chain starts
      const starts = [...text.matchAll(/\.(from|update|delete)\(|\borm\(\)/g)].map((m) => ({ i: m.index ?? 0, k: m[1] }));
      starts.forEach((s, n) => {
        if (!s.k) return;
        const segment = text.slice(s.i, starts[n + 1]?.i ?? text.length);
        expect(segment, `${file}: ${segment.slice(0, 80)}`).toMatch(/orgWhere\(\s*org,/);
      });
      // a join filters its own side too
      for (const m of text.matchAll(/\.(inner|left|right|full)Join\(\s*\w+,\s*(\S+)/g))
        expect(m[2], `${file}: join`).toMatch(/^orgWhere\(\s*org,/);
      // a module table inside a sql`…` template (sub-selects) only with orgWhere in the same template
      for (const m of text.matchAll(/from \$\{(\w+)\}([^`]*)`/g))
        expect(m[2], `${file}: sub-select from ${m[1]}`).toContain(`orgWhere(org, ${m[1]}`);
      // every insert is stamped
      for (const m of text.matchAll(/\.insert\(\w+\)\.values\(([^)]*)/g))
        expect(m[1], `${file}: insert`).toMatch(/^orgRows?\(\s*org,/);
      // raw SQL only through q = orgQuery(…) (the shared refresh of the view excepted)
      for (const m of text.matchAll(/\bdb\.query\(([^)]*)\)/g))
        expect(m[1], `${file}: db.query`).toMatch(/^'REFRESH MATERIALIZED VIEW /);
      expect(text.match(/pool\.query\(/g)?.length ?? 0, `${file}: pool.query`).toBeLessThanOrEqual(1);
      if (text.includes('pool.query(')) expect(text).toMatch(/orgQuery\(\{ query: \(text, values\) => pool\.query\(text, values\) \}, org\)/);
      // every literal of q( / one( names org_id for each module table it reads or writes, and $1
      // every call of q( / one( has its SQL as a literal right there (no SQL built elsewhere)
      // (the registry's `one` passes its own literal on: `q<Row>(sql, params)`)
      const calls = text.match(/\b(?:q|one)(?:<[^>(]*>)?\((?!sql, params\))/g)?.length ?? 0;
      expect(sqlLiterals(text, ['q', 'one']).length, `${file}: q( calls with a literal`).toBe(calls);
      for (const lit of sqlLiterals(text, ['q', 'one'])) {
        const refs = [...lit.matchAll(/\b(?:FROM|JOIN|UPDATE|INTO)\s+([a-z_]+(?:\.[a-z_]+)?)/gi)]
          .map((m) => m[1] as string)
          .filter((t) => tableNames.has(t));
        const orgIds = lit.match(/\borg_id\b/g)?.length ?? 0;
        expect(orgIds, `${file}: ${lit.slice(0, 120)}`).toBeGreaterThanOrEqual(refs.length);
        if (refs.length > 0) expect(lit, `${file}: ${lit.slice(0, 120)}`).toMatch(/\$1(?!\d)/);
      }
    }
  });

  it('only src/orgs and src/auth are global (by name); no other source file reads the organization tables', () => {
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
        d.isDirectory() ? files(join(dir, d.name)) : d.name.endsWith('.ts') ? [join(dir, d.name)] : [],
      );
    const allowed = [join(SRC, 'orgs'), join(SRC, 'auth')];
    for (const f of files(SRC)) {
      if (allowed.some((a) => f.startsWith(a))) continue;
      expect(read(f), f).not.toMatch(/orgs\.organizations|auth\.users|pgSchema\('(orgs|auth)'\)/);
    }
  });
});

describe('two organizations in one database (D-170)', () => {
  const ISRC = 'QZTST2690001';
  const UPC = '2690000000001';

  async function openOrg(orgId: string) {
    const stack = await testStack();
    const dataDir = join(TMP, `org-${randomUUID()}`);
    mkdirSync(dataDir, { recursive: true });
    const sources = createSourcesService({
      registry: createSourceFilesRegistry(stack.pg.pool, orgScope(orgId)),
      columnar: stack.columnar,
      storageDir: join(dataDir, 'orgs', orgId, 'files', 'sources'),
    });
    const f = openFacade({ db: stack.db, orgId, dataDir, payoutThresholdCents: 0, sources });
    const label = await f.modules.labels.createLabel({ name: '0to8', kind: 'own' });
    await f.modules.labels.addAlias(label.id, 'Test Label');
    await f.modules.labels.addAccount(label.id, '1052428');
    return { f, label: label.id };
  }

  /** The same catalogue, rows and files in an organization: everything that is unique within one. */
  async function fill(o: Awaited<ReturnType<typeof openOrg>>, believe: { path: string; fileName: string }, b17: { path: string; fileName: string }) {
    const { f, label } = o;
    const { owner, artists } = await confirmedOwner(f as never, 'Owner Same', ['Pseudonym Same']);
    const artist = artists[0]!;
    await f.modules.owners.addOwnerAlias(owner.id, 'Alias Same');
    await f.modules.owners.createTrack({ isrc: ISRC, upc: UPC, title: 'Track Same' });
    const appendix = await approvedAppendix(f as never, owner.id);
    await f.createSplit({ isrc: ISRC, validFrom: '2020-01-01', shares: [{ artistId: artist.id, percent: '50' }], documentId: appendix.id });
    const other = await f.modules.owners.createArtist({ pseudonym: 'Participant Same', ownerId: owner.id });
    await f.createParticipation({
      isrc: ISRC,
      artistId: other.id,
      percent: '10',
      base: 'bucket',
      fundedFrom: 'label_share',
      validFrom: '2020-01-01',
      documentId: appendix.id,
    });
    await f.ingestBelieve(believe, label);
    await f.ingestB17(b17, label);
    await f.createAds([{ isrc: ISRC, month: '2026-07', amount: '5', labelId: label, externalRef: 'ref-same' }]);
    return { owner, artist };
  }

  it('the same keys in both without a conflict; A never sees B, and B does not change A', async () => {
    const stack = await testStack();
    await stack.reset();
    await stack.resetModules();
    const orgB = await createOrgsService(stack.db).createOrganization({ name: `Org B ${randomUUID()}`, createdBy: 'tests' });
    const a = await openOrg(stack.orgId);
    const b = await openOrg(orgB.id);

    // one file each, byte for byte the same (one sha256), one B17 statement for the same quarter
    const believe = writeBelieve('2026-07', [{ isrc: ISRC, upc: UPC, net: '100' }]);
    const b17 = await writeB17('Q22026', [{ writer: 'OWNER SAME', title: 'Song', payable: '60' }]);

    const inA = await fill(a, believe, b17);
    const json = (x: unknown) =>
      JSON.stringify(x, (_k, v: unknown) => (v instanceof Map ? [...v] : v instanceof Set ? [...v] : v));
    const calcA = await calculate({ ...a.f.modules, db: a.f.db });
    const overviewA = await a.f.overview();
    const ownersA = await a.f.modules.owners.listOwners();

    const inB = await fill(b, believe, b17);
    expect(inB.owner.id).not.toBe(inA.owner.id);

    // A unchanged after B loaded the same everything
    expect(json(await calculate({ ...a.f.modules, db: a.f.db }))).toBe(json(calcA));
    expect({ ...(await a.f.overview()), calculatedAt: '' }).toEqual({ ...overviewA, calculatedAt: '' });
    expect(await a.f.modules.owners.listOwners()).toEqual(ownersA);

    // no row of B is visible in A, and the other way round
    const aText = json([ownersA, calcA, overviewA, await a.f.modules.sources.listFiles(), await a.f.modules.publishing.listStatements()]);
    const bIds = [inB.owner.id, inB.artist.id, b.label, ...(await b.f.modules.sources.listFiles()).map((x) => x.id)];
    for (const id of bIds) expect(aText).not.toContain(id);
    expect(await a.f.modules.owners.getOwner(inB.owner.id).catch((e: { code?: string }) => e.code)).toBe('not_found');
    expect(await b.f.modules.owners.getOwner(inA.owner.id).catch((e: { code?: string }) => e.code)).toBe('not_found');
    expect((await a.f.modules.sources.listFiles()).length).toBe(1);
    expect((await b.f.modules.sources.listFiles()).length).toBe(1);
    expect((await a.f.listAds()).count).toBe(1);
    expect((await b.f.listAds()).count).toBe(1);

    // the money of the two organizations is the same, separately
    const calcB = await calculate({ ...b.f.modules, db: b.f.db });
    expect(json(calcB.units.map((u) => u.allocations.map((x) => x.amount)))).toBe(json(calcA.units.map((u) => u.allocations.map((x) => x.amount))));
  });

  it('a facade refuses sources of another organization', async () => {
    const stack = await testStack();
    expect(() =>
      openFacade({ db: stack.db, orgId: randomUUID(), dataDir: TMP, payoutThresholdCents: 0, sources: stack.service }),
    ).toThrow(/another organization/);
  });
});

describe('two organizations behind the login: the API (D-170)', () => {
  const SECRET = randomBytes(32).toString('hex');
  const PASSWORD = randomBytes(12).toString('hex');
  const sfx = randomUUID().slice(0, 8);
  const ISRC_B = 'QZTST2699901';
  const UPC_B = '2699900000001';
  const B_NAMES = ['B Owner Secret', 'B Pseudo Secret', 'B Second Secret', 'B Label Secret', 'B Sub Secret', 'B WRITER SECRET', 'B Song Secret', 'B Track Secret'];

  type Ids = {
    owner: string; artist: string; artist2: string; track: string; document: string; split: string;
    participation: string; label: string; sublabel: string; rule: string; file: string; norm: string;
    operation: string; ad: string; isrc: string; upc: string; account: string; member: string; grant: string;
    /** D-173: a B17 statement */
    statement: string;
    pubFile: string;
    songwriter: string;
    song: string;
    /** D-174: an opening balance row */
    start: string;
    /** D-176: a contract, a payee, a hold, an answer */
    contract: string;
    payee: string;
    hold: string;
    answer: string;
  };
  type Call = { params?: Record<string, string>; query?: Record<string, string>; body?: unknown; file?: { path: string; fileName: string } };

  let app: Express;
  const cookie: Record<'a' | 'b' | 'sys', string> = { a: '', b: '', sys: '' };
  let orgA = '';
  let orgB = '';
  let B: Ids;
  /** The corrected file of the replacement walk (D-173). */
  let replaceFile: { path: string; fileName: string };
  let A: { label: string; owner: string; artist: string; document: string; buyout: string };

  const users = { a: `scope-a-${sfx}`, b: `scope-b-${sfx}`, sys: `scope-sys-${sfx}` };
  const as = <T extends request.Test>(who: 'a' | 'b' | 'sys', t: T): T => t.set('Cookie', cookie[who]).set('X-Operator', 'org-scope') as T;
  async function api(who: 'a' | 'b', method: 'get' | 'post' | 'patch', url: string, c: Call = {}) {
    let t = as(who, request(app)[method]('/api/v1' + url));
    if (c.query) t = t.query(c.query);
    if (c.file) t = t.attach('file', c.file.path, c.file.fileName);
    else if (c.body !== undefined) t = t.send(c.body as object);
    return t;
  }
  async function ok(who: 'a' | 'b', method: 'post' | 'patch' | 'get', url: string, body?: unknown): Promise<Record<string, any>> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const res = await api(who, method, url, { body });
    expect(res.status, `${method} ${url} -> ${JSON.stringify(res.body)}`).toBeLessThan(300);
    return res.body as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  }

  beforeAll(async () => {
    const stack = await testStack();
    await stack.reset();
    await stack.resetModules();
    orgA = stack.orgId;
    orgB = (await createOrgsService(stack.db).createOrganization({ name: `Org B API ${sfx}`, createdBy: 'tests' })).id;
    const dataDir = join(TMP, `org-api-${sfx}`);
    mkdirSync(dataDir, { recursive: true });
    const orgs = createOrgFacades({ stores: { db: stack.db, pool: stack.pg.pool, columnar: stack.columnar }, dataDir, payoutThresholdCents: 0 });
    const auth = createAuthService(stack.db);
    await auth.createUser({ login: users.a, password: PASSWORD, orgId: orgA, role: 'org_admin', createdBy: 'tests' });
    await auth.createUser({ login: users.b, password: PASSWORD, orgId: orgB, role: 'org_admin', createdBy: 'tests' });
    await auth.createUser({ login: users.sys, password: PASSWORD, system: true, createdBy: 'tests' });
    app = createServerApp({ orgs, auth: { service: auth, config: { mode: 'on', secret: SECRET } } });
    for (const who of ['a', 'b', 'sys'] as const) {
      const res = await request(app).post('/api/v1/auth/login').send({ login: users[who], password: PASSWORD }).expect(200);
      cookie[who] = ((res.headers['set-cookie'] as unknown as string[])[0] as string).split(';')[0] as string;
    }

    // A: an own label, a confirmed owner with a pseudonym, an approved appendix
    const la = await ok('a', 'post', '/labels', { name: '0to8', kind: 'own' });
    const oa = await ok('a', 'post', '/owners', { name: 'A Owner', kind: 'person' });
    const aa = await ok('a', 'post', '/artists', { pseudonym: 'A Pseudo', ownerId: oa.id });
    const da = await ok('a', 'post', '/documents', { kind: 'appendix', title: 'A appendix', fileRef: 'dummy://a.pdf', requiresApproval: false });
    const ba = await ok('a', 'post', '/documents', { kind: 'buyout', title: 'A buyout', fileRef: 'dummy://b.pdf', requiresApproval: false });
    A = { label: la.id, owner: oa.id, artist: aa.id, document: da.id, buyout: ba.id };

    // B: the same kinds of everything, under other names and ids
    const lb = await ok('b', 'post', '/labels', { name: 'B Label Secret', kind: 'own' });
    await ok('b', 'post', `/labels/${lb.id}/aliases`, { alias: 'Test Label' });
    await ok('b', 'post', `/labels/${lb.id}/accounts`, { account: '2799555' });
    const sb = await ok('b', 'post', '/labels', { name: 'B Sub Secret', kind: 'sublabel', ownLabelId: lb.id });
    const ob = await ok('b', 'post', '/owners', { name: 'B Owner Secret', kind: 'person' });
    const ab = await ok('b', 'post', '/artists', { pseudonym: 'B Pseudo Secret', ownerId: ob.id });
    const ab2 = await ok('b', 'post', '/artists', { pseudonym: 'B Second Secret', ownerId: ob.id });
    const contract = await ok('b', 'post', '/documents', { kind: 'contract', title: 'B contract', fileRef: 'dummy://c.pdf', ownerId: ob.id, requiresApproval: true });
    await ok('b', 'post', `/documents/${contract.id}/approve`, {});
    const cb = await ok('b', 'post', '/contracts', { ownerId: ob.id, documentId: contract.id, artistIds: [ab.id] });
    // D-176: the admission rows of B
    const payeeB = await ok('b', 'post', '/settlements/payees', { ownerId: ob.id, channel: 'easystaff', basis: 'scope', validFrom: '2026-01-01' });
    const holdB = await ok('b', 'post', '/settlements/holds', { ownerId: ob.id, kind: 'decision', reason: 'scope', since: '2026-01-01' });
    const answerB = await ok('b', 'post', '/settlements/answers', { ownerId: ob.id, due: '1.00', decision: 'pay', why: 'scope', answeredBy: 'scope' });
    const db_ = await ok('b', 'post', '/documents', { kind: 'appendix', title: 'B appendix', fileRef: 'dummy://b.pdf', requiresApproval: false });
    const tb = await ok('b', 'post', '/tracks', { title: 'B Track Secret', isrc: ISRC_B, upc: UPC_B });
    const spb = await ok('b', 'post', '/splits', { isrc: ISRC_B, validFrom: '2026-01-01', shares: [{ artistId: ab.id, percent: '50' }], documentId: db_.id });
    const pb = await ok('b', 'post', '/participations', { isrc: ISRC_B, artistId: ab2.id, percent: '5', base: 'net', fundedFrom: 'top', validFrom: '2026-01-01', documentId: db_.id });
    const rb = await ok('b', 'post', `/labels/${sb.id}/rules`, { percent: '30', recipientArtistId: ab2.id, validFrom: '2026-01-01', documentId: db_.id });
    const believe = writeBelieve('2026-07', [{ isrc: ISRC_B, upc: UPC_B, net: '100' }], { account: '2799555' });
    const fb = await as('b', request(app).post('/api/v1/sources/believe')).query({ label: lb.id }).attach('file', believe.path, believe.fileName);
    expect(fb.status, JSON.stringify(fb.body)).toBe(201);
    const b17 = await writeB17('Q22026', [{ writer: 'B WRITER SECRET', title: 'B Song Secret', payable: 10 }]);
    const sb17 = await as('b', request(app).post('/api/v1/publishing/b17')).query({ label: lb.id }).attach('file', b17.path, b17.fileName);
    expect(sb17.status, JSON.stringify(sb17.body)).toBe(201);
    const pubBook = new ExcelJS.Workbook();
    pubBook.addWorksheet('Songwriter Breakdown').addRows([
      ['SONG', 'GROSS', 'WITHHOLDING', 'TOTAL PAYABLE'],
      ['SONGWRITER: Secret Writer', 2, 0, 2],
      ['  Secret Song', 2, 0, 2],
    ]);
    const pubPath = join(TMP, `scope-pubv2-${randomUUID()}.xlsx`);
    await pubBook.xlsx.writeFile(pubPath);
    const pubFile = await as('b', request(app).post('/api/v1/publishing-v2/files')).query({ label: lb.id }).attach('file', pubPath, 'scope_Q22026.xlsx');
    expect(pubFile.status, JSON.stringify(pubFile.body)).toBe(201);
    const pubWriters = (await ok('b', 'get', '/publishing-v2/songwriters')) as unknown as { id: string }[];
    const pubSongs = (await ok('b', 'get', '/publishing-v2/songs')) as unknown as { songId: string }[];
    const writers = (await ok('b', 'get', '/publishing/writers')) as unknown as { writerNorm: string }[];
    replaceFile = await writeB17('Q22026', [{ writer: 'A WRITER', title: 'A Song', payable: 11 }], 'scope_replace_Q22026.xlsx');
    await ok('b', 'post', '/publishing/terms', { ownerId: ob.id, percent: '50', validFrom: '2026-01-01' });
    const opb = await ok('b', 'post', '/settlements/operations', { direction: 'in', amount: '1.00', artistId: ab.id, date: '2026-08-01', comment: 'B', labelId: lb.id });
    const adb = await ok('b', 'post', '/ads', { items: [{ isrc: ISRC_B, month: '2026-07', amount: '5', labelId: lb.id }] });
    // D-174: a start row of B's pseudonym in B's book
    const startFile = join(TMP, `scope-start-${sfx}.csv`);
    writeFileSync(startFile, 'pseudonym;master\nB Pseudo Secret;1\n');
    const stb = await as('b', request(app).post('/api/v1/settlements/start/import')).query({ label: lb.id, cutoff: '2026-07', syncedAt: '2026-08-01T00:00:00Z', dryRun: '0', basis: 'scope' }).attach('file', startFile, 'start.csv');
    expect(stb.status, JSON.stringify(stb.body)).toBe(201);
    B = {
      owner: ob.id, artist: ab.id, artist2: ab2.id, track: tb.id, document: db_.id, split: spb.id, participation: pb.id,
      label: lb.id, sublabel: sb.id, rule: rb.id, file: fb.body.id, norm: writers[0]?.writerNorm ?? '', operation: opb.id,
      ad: adb.created[0].id, isrc: ISRC_B, upc: UPC_B, account: '2799555', statement: sb17.body.statement.id, pubFile: pubFile.body.id, songwriter: pubWriters[0]?.id as string, song: pubSongs[0]?.songId as string, start: stb.body.result.ids[0] as string,
      contract: cb.id, payee: payeeB.id, hold: holdB.id, answer: answerB.id,
      // D-171: a member of B and a (revoked) support grant of B
      member: (await ok('b', 'post', '/users', { login: `scope-bm-${sfx}`, password: PASSWORD, role: 'label_manager', labelIds: [lb.id] })).id,
      grant: (await ok('b', 'post', '/support', { login: users.sys })).id,
    };
    await ok('b', 'post', `/support/${B.grant}/revoke`);
  });

  const unknown = (): Ids => {
    const u = () => randomUUID();
    return {
      owner: u(), artist: u(), artist2: u(), track: u(), document: u(), split: u(), participation: u(), label: u(),
      sublabel: u(), rule: u(), file: u(), norm: 'NOBODY KNOWN', operation: u(), ad: u(), isrc: 'QZTST2698888',
      upc: '2698800000001', account: '2799666', member: u(), grant: u(), statement: u(), pubFile: u(), songwriter: u(), song: u(), start: u(), contract: u(), payee: u(), hold: u(), answer: u(),
    };
  };

  /** Every operation of an organization: how to call it with the ids of `x` (B's or unknown ones). */
  const CASES: Record<string, (x: Ids) => Call> = {
    'GET /search': () => ({ query: { q: 'Secret' } }),
    'GET /owners': (x) => ({ query: { label: x.label } }),
    'GET /users': () => ({}),
    'POST /users': (x) => ({ body: { login: `scope-new-${sfx}`, password: 'p', role: 'label_manager', labelIds: [x.label] } }),
    'PATCH /users/:id': (x) => ({ params: { id: x.member }, body: { active: false } }),
    'POST /users/:id/password': (x) => ({ params: { id: x.member }, body: { password: 'p' } }),
    'GET /support': () => ({}),
    'POST /support': () => ({ body: { login: `scope-bm-${sfx}` } }),
    'POST /support/:id/revoke': (x) => ({ params: { id: x.grant } }),
    'POST /owners/merge': (x) => ({ body: { fromId: x.owner, intoId: A.owner, reason: 'r' } }),
    'GET /owners/payables': (x) => ({ query: { ids: x.owner } }),
    'GET /owners/:id': (x) => ({ params: { id: x.owner } }),
    'GET /owners/:id/balance': (x) => ({ params: { id: x.owner } }),
    'POST /owners/:id/payouts': (x) => ({ params: { id: x.owner }, body: { labelId: A.label } }),
    'GET /artists': (x) => ({ query: { label: x.label } }),
    'GET /artists/balances': (x) => ({ query: { ids: x.artist } }),
    'GET /artists/duplicates': () => ({}),
    'POST /artists': (x) => ({ body: { pseudonym: 'Into A', ownerId: x.owner } }),
    'GET /artists/:id': (x) => ({ params: { id: x.artist } }),
    'GET /artists/:id/balance': (x) => ({ params: { id: x.artist } }),
    'POST /artists/:id/owner': (x) => ({ params: { id: x.artist }, body: { ownerId: A.owner } }),
    'GET /tracks': () => ({}),
    'POST /tracks': (x) => ({ body: { title: 'Into A', artistIds: [x.artist] } }),
    'PATCH /tracks/:id': (x) => ({ params: { id: x.track }, body: { note: 'n' } }),
    'GET /tracks/summary': (x) => ({ query: { isrcs: x.isrc } }),
    'GET /tracks/catalog': (x) => ({ query: { label: x.label } }),
    'GET /tracks/:isrc/money': (x) => ({ params: { isrc: x.isrc } }),
    'GET /tracks/:isrc/breakdown/:month': (x) => ({ params: { isrc: x.isrc, month: '2026-07' } }),
    'GET /releases': (x) => ({ query: { q: x.upc } }),
    'GET /releases/:upc': (x) => ({ params: { upc: x.upc } }),
    'GET /documents/:id/uses': (x) => ({ params: { id: x.document } }),
    'GET /tracks/:isrc/explain': (x) => ({ params: { isrc: x.isrc } }),
    'GET /documents': (x) => ({ query: { ownerId: x.owner } }),
    'POST /documents': (x) => ({ body: { kind: 'other', title: 'Into A', requiresApproval: false, ownerId: x.owner } }),
    'PATCH /documents/:id': (x) => ({ params: { id: x.document }, body: { labelId: null } }),
    'POST /documents/:id/attach': (x) => ({ params: { id: x.document }, body: { fileRef: 'dummy://x.pdf' } }),
    'POST /documents/:id/approve': (x) => ({ params: { id: x.document }, body: {} }),
    'POST /contracts': (x) => ({ body: { ownerId: x.owner, documentId: x.document, artistIds: [x.artist] } }),
    'GET /splits': (x) => ({ query: { isrc: x.isrc } }),
    'POST /splits': (x) => ({ body: { isrc: 'QZTST2697777', validFrom: '2026-01-01', shares: [{ artistId: x.artist, percent: '10' }], documentId: A.document } }),
    'POST /splits/change': (x) => ({ body: { isrc: 'QZTST2697777', from: '2026-09-01', shares: [{ artistId: x.artist, percent: '10' }], documentId: A.document } }),
    'POST /splits/buyout': (x) => ({ body: { isrcs: [x.isrc], sellerArtistId: x.artist, effectiveFrom: '2026-06-01', documentId: A.buyout } }),
    'POST /splits/:id/confirm': (x) => ({ params: { id: x.split }, body: { documentId: A.document } }),
    'GET /participations': (x) => ({ query: { isrc: x.isrc } }),
    'POST /participations': (x) => ({ body: { isrc: 'QZTST2697777', artistId: x.artist, percent: '5', base: 'net', fundedFrom: 'top', validFrom: '2026-01-01', documentId: A.document } }),
    'POST /participations/:id/close': (x) => ({ params: { id: x.participation }, body: { validTo: '2026-09-01' } }),
    'GET /labels': () => ({}),
    'POST /labels': (x) => ({ body: { name: 'Into A sub', kind: 'sublabel', ownLabelId: x.label } }),
    'POST /labels/:id/accounts': (x) => ({ params: { id: x.label }, body: { account: '2799777' } }),
    'POST /labels/:id/accounts/:account/remove': (x) => ({ params: { id: x.label, account: x.account } }),
    'POST /labels/:id/aliases': (x) => ({ params: { id: x.sublabel }, body: { alias: 'Into A alias' } }),
    'POST /labels/:id/rules': (x) => ({ params: { id: x.sublabel }, body: { percent: '10', recipientArtistId: A.artist, validFrom: '2026-01-01', documentId: A.document } }),
    'POST /labels/rules/:id/close': (x) => ({ params: { id: x.rule }, body: { validTo: '2026-09-01' } }),
    'GET /sources/files': (x) => ({ query: { label: x.label } }),
    'GET /sources/lines': (x) => ({ query: { fileId: x.file } }),
    'GET /sources/lines/facets': (x) => ({ query: { fileId: x.file } }),
    'GET /publishing/writers': () => ({}),
    'GET /publishing-v2/files': (x) => ({ query: { label: x.label } }),
    'GET /publishing-v2/songwriters': (x) => ({ query: { label: x.label } }),
    'GET /publishing-v2/songs': (x) => ({ query: { label: x.label } }),
    'GET /publishing-v2/songs/:id/candidates': (x) => ({ params: { id: x.song } }),
    'POST /publishing-v2/songs/:id/isrcs': (x) => ({ params: { id: x.song }, body: { isrcs: [] } }),
    'POST /publishing-v2/terms/:id/cancel': (x) => ({ params: { id: x.pubFile }, body: { reason: 'scope check' } }),
    'POST /publishing-v2/terms': (x) => ({ body: { ownerId: x.owner, percent: '50', validFrom: '2026-01-01' } }),
    'GET /publishing-v2/links': (x) => ({ query: { label: x.label } }),
    'POST /publishing-v2/links': (x) => ({ body: { songwriterId: x.songwriter, ownerId: x.owner } }),
    'GET /publishing-v2/songwriters/:id': (x) => ({ params: { id: x.songwriter } }),
    'POST /publishing-v2/files/:id/remove': (x) => ({ params: { id: x.pubFile } }),
    'POST /publishing/writers/:norm/map': (x) => ({ params: { norm: x.norm }, body: { ownerId: A.owner } }),
    'POST /publishing/terms': (x) => ({ body: { ownerId: x.owner, percent: '10', validFrom: '2026-01-01' } }),
    'GET /reconciliation': () => ({}),
    'GET /signals': (x) => ({ query: { ownerId: x.owner } }),
    'GET /overview': () => ({}),
    'GET /queue/:reason': (x) => ({ params: { reason: 'split_unconfirmed' }, query: { ownerId: x.owner } }),
    'GET /settlements/operations': (x) => ({ query: { ownerId: x.owner } }),
    'POST /settlements/operations': (x) => ({ body: { direction: 'in', amount: '1.00', artistId: x.artist, date: '2026-08-01', comment: 'c', labelId: A.label } }),
    'PATCH /settlements/operations/:id': (x) => ({ params: { id: x.operation }, body: { labelId: A.label } }),
    'POST /settlements/operations/:id/proof': (x) => ({ params: { id: x.operation }, body: { fileRef: 'dummy://p.pdf' } }),
    'POST /settlements/operations/:id/deferred': (x) => ({ params: { id: x.operation }, body: { deferred: true } }),
    'POST /settlements/operations/:id/deactivate': (x) => ({ params: { id: x.operation }, body: { reason: 'r' } }),
    'POST /settlements/operations/:id/return': (x) => ({ params: { id: x.operation }, body: { fileRef: 'dummy://r.pdf', date: '2099-12-31', comment: 'c' } }),
    'GET /settlements/operations/:id/snapshot': (x) => ({ params: { id: x.operation } }),
    'GET /audit': (x) => ({ query: { entityId: x.owner } }),
    'GET /ads': (x) => ({ query: { artistId: x.artist } }),
    'POST /ads': (x) => ({ body: { items: [{ month: '2026-07', amount: '1', artistId: x.artist, scope: 'any', labelId: A.label }] } }),
    'GET /ads/summary': (x) => ({ query: { label: x.label } }),
    'GET /ads/:id': (x) => ({ params: { id: x.ad } }),
    'PATCH /ads/:id': (x) => ({ params: { id: x.ad }, body: { recoveryPercent: '0' } }),
    'POST /ads/:id/deactivate': (x) => ({ params: { id: x.ad }, body: { reason: 'r' } }),
    // stage 4 (D-172)
    'POST /splits/assume': (x) => ({ body: { labelId: A.label, splitIds: [x.split], reason: 'scope check' } }),
    'GET /tracks/:isrc/labels': (x) => ({ params: { isrc: x.isrc } }),
    'POST /tracks/:isrc/label': (x) => ({ params: { isrc: x.isrc }, body: { labelId: x.label, from: '2026-07-01' } }),
    'GET /releases/registry': (x) => ({ query: { label: x.label } }),
    'GET /onboarding': (x) => ({ query: { label: x.label } }),
    // stage 5 (D-173): B's statement replaced under A's label answers as an unknown statement (404)
    'POST /publishing/statements/:id/replace': (x) => ({ params: { id: x.statement }, query: { label: A.label }, file: replaceFile }),
    // the payroll (D-173): B's label is an unknown label (404)
    'GET /owners/payroll': (x) => ({ query: { label: x.label } }),
    // the opening balances (D-174): B's label is unknown, B's row is unknown
    'GET /settlements/start': (x) => ({ query: { label: x.label } }),
    'POST /settlements/start/:id/deactivate': (x) => ({ params: { id: x.start }, body: { reason: 'r' } }),
    // the admission (D-176): B's owner, label and rows are unknown in A
    'GET /settlements/admission': (x) => ({ query: { label: x.label } }),
    'POST /settlements/payees': (x) => ({ body: { ownerId: x.owner, channel: 'tipalti', basis: 'b', validFrom: '2026-01-01' } }),
    'POST /settlements/payees/:id/deactivate': (x) => ({ params: { id: x.payee }, body: { reason: 'r' } }),
    'POST /settlements/holds': (x) => ({ body: { ownerId: x.owner, kind: 'decision', reason: 'r', since: '2026-01-01' } }),
    'POST /settlements/holds/:id/release': (x) => ({ params: { id: x.hold }, body: { reason: 'r' } }),
    'POST /settlements/answers': (x) => ({ body: { ownerId: x.owner, due: '1.00', decision: 'pay', why: 'w', answeredBy: 'a' } }),
    'POST /settlements/answers/:id/deactivate': (x) => ({ params: { id: x.answer }, body: { reason: 'r' } }),
    'PATCH /contracts/:id': (x) => ({ params: { id: x.contract }, body: { payoutThresholdCents: 1 } }),
    // the forgiveness (D-173): B's operation forgiven under a with a's document answers as an unknown advance
    'POST /settlements/operations/:id/forgive': (x) => ({ params: { id: x.operation }, body: { amount: '1.00', date: '2026-08-15', documentId: A.document, comment: 'c' } }),
  };
  /** Writes that name no entity of another organization: they create in A and are not part of the walk. */
  // D-172: the uploads of stage 4 create in A from a file (their `?label=` is checked by the label guard before the
  // body, as for `POST /sources/believe`); the organization checklist names no entity at all
  const ID_LESS = [
    'POST /owners',
    'POST /sources/believe',
    'POST /publishing/b17',
    'POST /publishing-v2/files',
    'POST /publishing/writers/resolve',
    'POST /splits/import',
    // D-195: the preview reads a file; the apply writes rows of A keyed by UPC under the label the guard checked
    'POST /releases/preview',
    'POST /releases/preview/apply',
    'GET /onboarding/organization',
    // D-173: the operation import creates in A from a file whose owners, pseudonyms and documents are resolved inside
    // A's facade (another organization's are owner_not_found / pseudonym_not_found rows); its `?label=` is checked by
    // the label guard before the body
    'POST /settlements/operations/import',
    // D-174: the start import creates in A from a file (its pseudonyms are resolved inside A's facade)
    'POST /settlements/start/import',
  ];

  /**
   * Where the lookup itself answers an unknown key with `validation_error` today: an unknown file id («Not a loaded
   * Believe file», F10) and an unknown writer («Unknown writer»). Everywhere else the unknown id must reach the lookup.
   */
  const VALIDATION_ALLOWED = ['GET /sources/lines', 'GET /sources/lines/facets', 'POST /publishing/writers/:norm/map'];

  const secrets = () => [...Object.entries(B).filter(([k]) => k !== 'account').map(([, v]) => v), ...B_NAMES];
  /** The text of an answer without the values the request itself sent (an error message names the id it got). */
  function leaks(res: request.Response, c: Call): string[] {
    let text = JSON.stringify(res.body);
    const sent = [...Object.values(c.params ?? {}), ...Object.values(c.query ?? {}), ...(JSON.stringify(c.body ?? {}).match(/"[^"]*"/g) ?? []).map((s) => s.slice(1, -1))];
    for (const v of sent) if (v.length > 3) text = text.split(v).join('<sent>');
    return secrets().filter((s) => text.includes(s));
  }
  const url = (path: string, params: Record<string, string> = {}) =>
    path.replace(/:([A-Za-z]+)/g, (_m, n: string) => encodeURIComponent(params[n] ?? 'x'));
  const bView = async () => {
    const reads = [`/owners/${B.owner}`, `/artists/${B.artist}`, '/labels', `/splits?isrc=${ISRC_B}`, `/participations?isrc=${ISRC_B}`, '/settlements/operations', '/ads', '/documents', '/publishing/writers', '/sources/files', `/owners/${B.owner}/balance`];
    const out = [];
    for (const r of reads) out.push((await api('b', 'get', r)).body);
    return JSON.stringify(out).replace(/"calculatedAt":"[^"]*"/g, '');
  };

  it('every operation of the organization: B\'s ids under a answer as unknown ids, with nothing of B; writes leave no trace', async () => {
    const ops = API_OPERATIONS.filter((o) => o.access === 'org');
    expect(ops.map(operationKey).filter((k) => !CASES[k] && !ID_LESS.includes(k))).toEqual([]);
    const auditBefore = (await api('a', 'get', '/audit', { query: { limit: '500' } })).body.items.length as number;
    const bBefore = await bView();
    for (const o of ops) {
      const key = operationKey(o);
      const make = CASES[key];
      if (!make) continue;
      const withB = make(B);
      const withUnknown = make(unknown());
      const rb = await api('a', o.method, url(o.path, withB.params), withB);
      const ru = await api('a', o.method, url(o.path, withUnknown.params), withUnknown);
      expect([rb.status, rb.body?.error?.code], `${key}: B's ids vs unknown ids (${JSON.stringify(ru.body?.error ?? '')})`).toEqual([ru.status, ru.body?.error?.code]);
      expect(leaks(rb, withB), `${key}: B's data in the answer`).toEqual([]);
      // an unknown id must reach the lookup, not stop at validation (else the comparison proves nothing)
      if (!VALIDATION_ALLOWED.includes(key))
        expect(ru.body?.error?.code, `${key}: the unknown id stopped at validation: ${JSON.stringify(ru.body)}`).not.toBe('validation_error');
      if (o.method !== 'get') expect(rb.status, `${key}: a write with B's ids succeeded`).toBeGreaterThanOrEqual(400);
    }
    expect((await api('a', 'get', '/audit', { query: { limit: '500' } })).body.items.length).toBe(auditBefore);
    expect(await bView()).toBe(bBefore);
  });

  it('under a: the lists, the audit and the search have nothing of B; B\'s label is 404 in query, body and upload', async () => {
    const owners = await api('a', 'get', '/owners');
    expect(owners.status).toBe(200);
    expect((owners.body as { id: string }[]).map((o) => o.id)).toEqual([A.owner]);
    const audit = await api('a', 'get', '/audit', { query: { limit: '500' } });
    expect(audit.body.items.length).toBeGreaterThan(0);
    expect(leaks(audit, {})).toEqual([]);
    for (const r of ['/search?q=Secret', '/labels', '/sources/files', '/publishing/writers', '/overview', '/reconciliation', '/tracks', '/artists'])
      expect(leaks(await api('a', 'get', r), {}), r).toEqual([]);

    const notFound = (res: request.Response) => [res.status, res.body.error?.code];
    expect(notFound(await api('a', 'get', '/owners', { query: { label: B.label } }))).toEqual([404, 'not_found']);
    expect(notFound(await api('a', 'post', '/settlements/operations', { body: { direction: 'in', amount: '1', artistId: A.artist, date: '2026-08-01', labelId: B.label } }))).toEqual([404, 'not_found']);
    expect(notFound(await api('a', 'post', '/ads', { body: { items: [{ isrc: ISRC_B, month: '2026-07', amount: '1', labelId: B.label }] } }))).toEqual([404, 'not_found']);
    const file = writeBelieve('2026-07', [{ isrc: ISRC_B, upc: UPC_B, net: '1' }], { account: B.account });
    expect(notFound(await as('a', request(app).post('/api/v1/sources/believe')).query({ label: B.label }).attach('file', file.path, file.fileName))).toEqual([404, 'not_found']);
    expect(notFound(await as('a', request(app).post('/api/v1/settlements/operations/import')).query({ label: B.label }).attach('file', file.path, 'operations.csv'))).toEqual([404, 'not_found']);
  });

  it('X-Org: the system administrator needs it, an unknown one is 404, a user may not send it', async () => {
    const sys = (t: request.Test) => t.set('Cookie', cookie.sys);
    const none = await sys(request(app).get('/api/v1/owners'));
    expect([none.status, none.body.error?.code]).toEqual([400, 'org_required']);
    const unknownOrg = await sys(request(app).get('/api/v1/owners')).set('X-Org', randomUUID());
    expect([unknownOrg.status, unknownOrg.body.error?.code]).toEqual([404, 'org_not_found']);
    // D-171: only under a support grant of B's administrator
    const refused = await sys(request(app).get('/api/v1/owners')).set('X-Org', orgB);
    expect([refused.status, refused.body.error?.code]).toEqual([403, 'support_required']);
    const granted = await as('b', request(app).post('/api/v1/support')).send({ login: users.sys });
    expect(granted.status, JSON.stringify(granted.body)).toBe(201);
    const inB = await sys(request(app).get('/api/v1/owners')).set('X-Org', orgB);
    expect(inB.status).toBe(200);
    // the grant of B opens nothing in A
    const inA = await sys(request(app).get('/api/v1/owners')).set('X-Org', orgA);
    expect([inA.status, inA.body.error?.code]).toEqual([403, 'support_required']);
    const inBIds = (inB.body as { id: string }[]).map((o) => o.id);
    expect(inBIds).toContain(B.owner);
    expect(inBIds).not.toContain(A.owner);
    const fromA = await as('a', request(app).get('/api/v1/owners')).set('X-Org', orgA);
    expect([fromA.status, fromA.body.error?.code]).toEqual([403, 'forbidden']);
  });
});
