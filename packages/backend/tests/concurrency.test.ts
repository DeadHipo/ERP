import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openFacade } from '../src/facade';
import { orgFilesDir, sourcesFor } from '../src/connect-sources';
import { createOrgsService } from '../src/orgs/service';
import { writeB17, writeBelieve } from './helpers/fixtures';
import { testQuery, testStack } from './helpers/test-sources';
import { TMP } from './helpers/tmp-root';

// Uploads under organizations (stage 2, D-170): inside one process a load waits in the `serial()` queue of the
// organization's service; two processes (two services of one organization, two queues) are separated only by the
// database: the partial unique index `source_files_scope` (Believe) and the keys of `pub_statement_periods` /
// `pub_statements` (B17). Two organizations never block each other. Synthetic data only.

const ISRC1 = 'QZTST2695001';
const ISRC2 = 'QZTST2695002';
const UPC = '2695000000001';

/** The code of a rejected promise (ConflictError carries `code`). */
const codeOf = (r: PromiseSettledResult<unknown>) =>
  r.status === 'rejected' ? (r.reason as { code?: string }).code : 'fulfilled';

async function freshStack() {
  const stack = await testStack();
  await stack.reset();
  await stack.resetModules();
  return stack;
}

async function newOrg(name: string) {
  const stack = await testStack();
  return (await createOrgsService(stack.db).createOrganization({ name: `${name} ${randomUUID()}`, createdBy: 'tests' })).id;
}

function newDataDir() {
  const dir = join(TMP, `concurrency-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** The files in a directory (none if it does not exist). */
const filesIn = (dir: string) => (existsSync(dir) ? readdirSync(dir) : []);

describe('Believe uploads: two processes, two organizations (D-170)', () => {
  const rows = [
    { isrc: ISRC1, upc: UPC, net: '100' },
    { isrc: ISRC2, upc: UPC, net: '23.5' },
  ];

  it('two loads of one month in one organization by two processes give exactly one loaded file', async () => {
    const stack = await freshStack();
    const orgId = stack.orgId;
    const dataDir = newDataDir();
    const stores = { pool: stack.pg.pool, columnar: stack.columnar };
    // two services of the same organization over the same data directory = two processes (two serial() queues)
    const p1 = sourcesFor(stores, orgId, dataDir);
    const p2 = sourcesFor(stores, orgId, dataDir);
    const file = writeBelieve('2026-07', rows);

    const results = await Promise.allSettled([p1.ingestBelieve(file), p2.ingestBelieve(file)]);
    const loaded = results.filter((r) => r.status === 'fulfilled');
    expect(loaded.length).toBe(1);
    // The loser is refused by the scope check (the registry row of the winner is visible) or, when both passed the
    // pre-checks, by the unique index: `source_files_scope` is created before `source_files_sha` (0016), so PostgreSQL
    // checks it first and the 23505 names it. Either way the second load of the same account and month is a period
    // conflict, never a 500.
    expect(results.map(codeOf).sort()).toEqual(['duplicate_period', 'fulfilled']);

    const files = await p1.listFiles();
    expect(files.map((f) => f.status)).toEqual(['loaded']); // no `loading` and no `failed` row left
    expect(await p2.listFiles()).toEqual(files);
    const [only] = files;
    expect(only?.lineCount).toBe(2);
    expect(only?.netTotal).toBe('123.5');

    // the lines of the file are in ClickHouse exactly once
    const snap = await p1.snapshot();
    expect(snap.files.map((f) => f.id)).toEqual([only?.id]);
    expect(snap.units.length).toBe(2);
    expect(snap.units.reduce((s, u) => s + u.netPico, 0n)).toBe(123_500_000_000_000n);
    const [count] = await testQuery<{ n: string }>(
      (db) => `SELECT toString(count()) AS n FROM ${db}.rows WHERE file_id = '${only?.id}'`,
    );
    expect(count?.n).toBe('2');

    // one kept original: the one of the loaded file (both processes wrote the same <sha256>-<name>)
    const dir = orgFilesDir(dataDir, orgId, 'sources');
    expect(filesIn(dir).map((f) => join(dir, f))).toEqual([only?.storedPath]);
  });

  it('the same account and month in two organizations are both loaded', async () => {
    const stack = await freshStack();
    const orgA = stack.orgId;
    const orgB = await newOrg('Org B concurrency');
    const dataDir = newDataDir();
    const stores = { pool: stack.pg.pool, columnar: stack.columnar };
    const a = sourcesFor(stores, orgA, dataDir);
    const b = sourcesFor(stores, orgB, dataDir);
    const file = writeBelieve('2026-07', rows); // the same bytes, one sha256, one account and month

    const [fa, fb] = await Promise.all([a.ingestBelieve(file), b.ingestBelieve(file)]);
    expect(fa.status).toBe('loaded');
    expect(fb.status).toBe('loaded');
    expect(fa.sha256).toBe(fb.sha256);
    expect(fa.id).not.toBe(fb.id);

    // each organization sees only its own file and its own units
    const sa = await a.snapshot();
    const sb = await b.snapshot();
    expect(sa.files.map((f) => f.id)).toEqual([fa.id]);
    expect(sb.files.map((f) => f.id)).toEqual([fb.id]);
    expect(sa.units.length).toBe(2);
    expect(sb.units.length).toBe(2);
    expect((await a.listFiles()).map((f) => f.id)).toEqual([fa.id]);
    expect((await b.listFiles()).map((f) => f.id)).toEqual([fb.id]);

    // the ClickHouse rows of the two loads carry different file ids, two rows each
    const byFile = await testQuery<{ fid: string; n: string }>(
      (db) => `SELECT toString(file_id) AS fid, toString(count()) AS n FROM ${db}.rows GROUP BY fid ORDER BY fid`,
    );
    expect(byFile).toEqual([fa.id, fb.id].sort().map((fid) => ({ fid, n: '2' })));
  });
});

describe('B17 uploads: two processes, two organizations (D-170)', () => {
  /** A facade of an organization over the shared stores, with one own label (created once per organization). */
  async function openOrg(orgId: string, dataDir: string, labelId?: string) {
    const stack = await testStack();
    const sources = sourcesFor({ pool: stack.pg.pool, columnar: stack.columnar }, orgId, dataDir);
    const f = openFacade({ db: stack.db, orgId, dataDir, payoutThresholdCents: 0, sources });
    const label = labelId ?? (await f.modules.labels.createLabel({ name: '0to8', kind: 'own' })).id;
    return { f, label };
  }

  const statement = () =>
    writeB17('Q22026', [
      { writer: 'WRITER ONE', title: 'Song One', payable: '60' },
      { writer: 'WRITER TWO', title: 'Song Two', payable: '15.25' },
    ]);

  it('two loads of one quarter in one organization by two processes give exactly one loaded statement', async () => {
    const stack = await freshStack();
    const orgId = stack.orgId;
    const dataDir = newDataDir();
    const p1 = await openOrg(orgId, dataDir);
    const p2 = await openOrg(orgId, dataDir, p1.label); // the second process sees the label of the first
    const file = await statement();

    const results = await Promise.allSettled([p1.f.ingestB17(file, p1.label), p2.f.ingestB17(file, p2.label)]);
    expect(results.filter((r) => r.status === 'fulfilled').length).toBe(1);
    // The loser is refused by the quarter pre-check, by the check inside the write transaction (the advisory lock
    // orders the two), or by the key of pub_statement_periods: all three are `duplicate_period`.
    expect(results.map(codeOf).sort()).toEqual(['duplicate_period', 'fulfilled']);

    const statements = await p1.f.modules.publishing.listStatements();
    expect(statements.map((s) => [s.status, s.periods, s.lineCount, s.totalPayable])).toEqual([
      ['loaded', ['2026-Q2'], 2, '75.25'],
    ]);
    expect(await p2.f.modules.publishing.listStatements()).toEqual(statements);

    // the kept original of the loaded statement is still there (the loser must not remove it), and nothing else
    const dir = orgFilesDir(dataDir, orgId, 'publishing');
    expect(filesIn(dir)).toEqual([`${statements[0]?.sha256}-${file.fileName}`]);
  });

  it('the same statement and quarter in two organizations are both loaded', async () => {
    const stack = await freshStack();
    const orgB = await newOrg('Org B concurrency B17');
    const dataDir = newDataDir();
    const a = await openOrg(stack.orgId, dataDir);
    const b = await openOrg(orgB, dataDir);
    const file = await statement();

    const [ra, rb] = await Promise.all([a.f.ingestB17(file, a.label), b.f.ingestB17(file, b.label)]);
    expect(ra.statement.status).toBe('loaded');
    expect(rb.statement.status).toBe('loaded');
    expect(ra.statement.sha256).toBe(rb.statement.sha256);
    expect(ra.statement.id).not.toBe(rb.statement.id);

    expect((await a.f.modules.publishing.listStatements()).map((s) => s.id)).toEqual([ra.statement.id]);
    expect((await b.f.modules.publishing.listStatements()).map((s) => s.id)).toEqual([rb.statement.id]);
    for (const [o, org] of [
      [a, stack.orgId],
      [b, orgB],
    ] as const) {
      expect(filesIn(orgFilesDir(dataDir, org, 'publishing'))).toEqual([`${ra.statement.sha256}-${file.fileName}`]);
      expect((await o.f.modules.publishing.listStatements())[0]?.totalPayable).toBe('75.25');
    }
  });
});
