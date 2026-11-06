import { describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
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
const MODULES = ['owners', 'splits', 'labels', 'settlements', 'publishing', 'audit', 'ads'];
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
    expect(tables.length).toBe(26);
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
