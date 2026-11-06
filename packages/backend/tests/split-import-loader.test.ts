import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from '../src/api/app';
import { newFacade, tmpPath, TMP, type TestFacade } from './helpers/fixtures';
import { testStack } from './helpers/test-sources';
import { writer } from './helpers/writer';

// D-172, plan «этап4_онбординг.md» §6 (FIX-8): the split import of the converted diff = the loader's `splits` step.
// Preconditions: (a) the step logs no `split_error` / `unresolved_name`; (b) the converter always writes `artist_id`
// and the synthetic diff has no ambiguous name without an id; (c) the converter repeats the step's filters and order;
// (d) MVP_LOAD_DIR is set before the loader is imported dynamically (its LOAD_DIR is read at module load).
// Synthetic names and ISRCs only.

const ANNEX = 'Annex 14 Splits by ISRC 2026-11-02';
const I = (n: number) => `QZTST26${String(20000 + n).padStart(5, '0')}`;

/** The same reference data in each store: two pseudonyms, the Annex document, a row document, one existing split. */
async function seed(f: TestFacade) {
  const o = f.modules.owners;
  const one = await o.createArtist({ pseudonym: 'Equal One', ownerId: null });
  const two = await o.createArtist({ pseudonym: 'Equal Two', ownerId: null });
  await o.createDocument({ kind: 'appendix', title: ANNEX, ownerId: null, requiresApproval: true });
  const rowDoc = await o.createDocument({ kind: 'appendix', title: 'Equal row document', ownerId: null, requiresApproval: false });
  await f.createSplit({ isrc: I(3), validFrom: '2024-01-01', shares: [{ artistId: one.id, percent: '50', documentId: rowDoc.id }] });
  return { one: one.id, two: two.id };
}

/** A synthetic `annex/splits_diff.json` of the stage 4 format (every filter of the step is exercised). */
function diffOf(ids: { one: string; two: string }) {
  const row = (name: string, percent: number, artistId: string | null) => ({ name, percent, artistId, candidates: null });
  const rec = (isrc: string, classification: string, from: string | null, rows: ReturnType<typeof row>[]) => ({
    isrc,
    classification,
    subtype: 'synthetic',
    annex: { period: { from, kind: 'synthetic' }, rowsExpected: rows, rowsBasis: 'synthetic' },
  });
  return {
    records: [
      rec(I(1), 'missing_in_erp', '2025-03-15', [row('Equal One', 40, ids.one), row('Equal Newcomer', 15, null)]),
      rec(I(2), 'missing_in_erp', null, [row('Equal Two', 30, ids.two), row('Equal Zero', 0, null)]),
      rec(I(3), 'different_rows', '2026-01-01', [row('Equal One', 50, ids.one), row('Equal Two', 20, ids.two)]),
      rec(I(4), 'same', '2026-01-01', [row('Equal One', 10, ids.one)]),
      rec(I(5), 'different_period', '2026-01-01', [row('Equal One', 10, ids.one)]),
      rec(I(6), 'missing_in_erp', '2026-01-01', [row('Equal One', 10, ids.one)]), // M51
      rec(I(7), 'missing_in_erp', '2026-01-01', [row('Equal One', 10, ids.one)]), // a participations rewrite
      rec(I(8), 'different_rows', '2026-01-01', [row('Equal One', 10, ids.one)]), // a pp buyout with an ERP period
      rec(I(9), 'missing_in_erp', '2026-01-01', [row('Equal One', 0, ids.one)]), // no rows above 0
      rec(I(10), 'erp_only', '2026-01-01', [row('Equal One', 10, ids.one)]),
      rec(I(11), 'missing_in_erp', '2025-01-01', [row('Equal Newcomer', 25, null)]),
      rec(I(11), 'missing_in_erp', '2026-02-10', [row('Equal Newcomer', 35, null), row('Equal Two', 5, ids.two)]),
    ],
    buyouts: [
      { isrc: I(8), interestKind: 'pp', seller: 'x', instrument: 'x', effectiveDate: '2026-01-01', erpSplitsStartingInEffectiveMonth: [{}] },
    ],
    m51SeeInstrument: [{ isrc: I(6), seller: 'x', instrument: 'x', effectiveDate: '2026-01-01', sellerPercentPerRow: null }],
    m52Normalisations: [],
  };
}
const participations = { participations: [], splitRewrites: [{ isrc: I(7), group: 'g', validFrom: '2026-01-01' }], unresolved: [] };

function writeLoadDir(ids: { one: string; two: string }): string {
  const dir = join(tmpPath('mvp-load'), '..', 'mvp-load');
  mkdirSync(join(dir, 'annex'), { recursive: true });
  writeFileSync(join(dir, 'annex', 'splits_diff.json'), JSON.stringify(diffOf(ids)));
  writeFileSync(join(dir, 'annex', 'participations.json'), JSON.stringify(participations));
  return dir;
}

/** The splits as text: ISRC, period, the document of the split and of each row by title, pseudonyms and percents. */
async function projection(f: TestFacade): Promise<string> {
  const docs = new Map((await f.modules.owners.listDocuments()).map((d) => [d.id, d.title]));
  const title = (id: string | null) => (id ? (docs.get(id) ?? '?') : '-');
  return (await f.listSplits({ limit: 1000 })).items
    .map((s) =>
      [
        `${s.isrc} ${s.validFrom}..${s.validTo ?? 'open'} doc=${title(s.documentId)}`,
        ...s.shares.map((x) => `  ${x.pseudonym} ${x.percent} doc=${title(x.documentId)}`).sort(),
      ].join('\n'),
    )
    .sort()
    .join('\n');
}

describe('split import = the loader step `splits` (D-172)', () => {
  it('the loader on store A and the import of the converted csv on store B give the same splits', async () => {
    // store A: the loader's step, imported only after MVP_LOAD_DIR is set (d)
    const a = await newFacade();
    const dirA = writeLoadDir(await seed(a));
    process.env.MVP_LOAD_DIR = dirA;
    try {
    const lib = await import('../scripts/mvp/lib');
    const { stepSplits } = await import('../scripts/mvp/steps-annex');
    expect(lib.LOAD_DIR).toBe(dirA);
    const stack = await testStack();
    const ctx = new lib.Ctx(true, {
      db: stack.db,
      orgId: a.orgId,
      sources: a.modules.sources,
      close: async () => undefined,
    } as unknown as ConstructorParameters<typeof lib.Ctx>[1]);
    await ctx.load();
    ctx.log = new lib.Log('splits', true);
    await stepSplits(ctx);
    // (a) the step refused nothing and resolved every name
    expect(ctx.log.counts.get('split_error') ?? 0, ctx.log.summary()).toBe(0);
    expect(ctx.log.counts.get('unresolved_name') ?? 0, ctx.log.summary()).toBe(0);
    expect(ctx.log.counts.get('split_created')).toBe(3);
    expect(ctx.log.counts.get('split_changed')).toBe(2);
    const textA = await projection(a);

    // store B: the converter (b, c), then POST /splits/import?dryRun=0
    const b = await newFacade();
    const dirB = writeLoadDir(await seed(b));
    const { splitsDiffToCsv } = await import('../scripts/mvp/splits-diff-to-csv');
    const { readFileSync } = await import('node:fs');
    const csv = splitsDiffToCsv(
      JSON.parse(readFileSync(join(dirB, 'annex', 'splits_diff.json'), 'utf8')),
      JSON.parse(readFileSync(join(dirB, 'annex', 'participations.json'), 'utf8')),
    );
    expect(csv.split('\n')[0]).toContain('artist_id');
    const path = tmpPath('splits-diff.csv');
    writeFileSync(path, csv);
    const app = createApp(b, { tmpDir: join(TMP, 'split-import-loader-uploads') });
    const res = await writer(app)
      .post('/api/v1/splits/import')
      .query({ label: b.testLabels['0to8'], dryRun: '0' })
      .attach('file', path, 'splits-diff.csv');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.totals).toMatchObject({ create: 3, change: 2, errors: 0 });
    const textB = await projection(b);

    expect(textB).toBe(textA);
    expect(textA).toContain(`${I(1)} 2025-03-01..open doc=${ANNEX}`);
    expect(textA).toContain('  Equal One 50 doc=Equal row document'); // the equal percent kept its row document
    } finally {
      delete process.env.MVP_LOAD_DIR;
    }
  });
});
