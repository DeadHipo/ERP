import { describe, expect, it } from 'vitest';
import { approvedAppendix, newFacade } from './helpers/fixtures';

// The sublabels (D-217): a register of names in `labels` and the terms of a sublabel on a track in `links`, by the
// rules of the publishing terms (D-185, D-188). The money does not read them. Synthetic names and ISRCs only.

const A = 'FRX282600001';
const B = 'FRX282600002';

describe('the register of sublabels (D-217)', () => {
  it('creates, lists by name and renames; a name is unique without case', async () => {
    const f = await newFacade();
    const l = f.modules.labels;
    const b = await l.createSublabel('  Beta Records ');
    const a = await l.createSublabel('Alpha');
    expect(b.name).toBe('Beta Records');
    expect((await l.listSublabels()).map((s) => s.name)).toEqual(['Alpha', 'Beta Records']);
    await expect(l.createSublabel('alpha')).rejects.toMatchObject({ code: 'sublabel_name_taken' });
    await expect(l.createSublabel('  ')).rejects.toMatchObject({ code: 'validation_error' });
    await expect(l.renameSublabel(b.id, 'ALPHA')).rejects.toMatchObject({ code: 'sublabel_name_taken' });
    expect((await l.renameSublabel(a.id, 'ALPHA')).name).toBe('ALPHA');
    expect((await l.renameSublabel(b.id, 'Gamma')).name).toBe('Gamma');
    await expect(l.getSublabel('nope')).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('the terms of a sublabel on a track (D-217)', () => {
  async function world() {
    const f = await newFacade();
    const one = await f.modules.labels.createSublabel('One');
    const two = await f.modules.labels.createSublabel('Two');
    return { f, links: f.modules.links, one: one.id, two: two.id };
  }

  it('stores a batch with canonical percents; the dates must be month starts', async () => {
    const { links, one } = await world();
    const rows = await links.addSublabelTerms(
      [
        { sublabelId: one, isrc: A, percent: '50.000', validFrom: '2025-11-01' },
        { sublabelId: one, isrc: B, percent: '25', validFrom: '2026-03-01', validTo: '2027-01-01', documentId: 'doc-1', note: ' n ' },
      ],
      'tester',
    );
    expect(rows.map((r) => [r.isrc, r.percent, r.validFrom, r.validTo, r.documentId, r.note])).toEqual([
      [A, '50', '2025-11-01', null, null, null],
      [B, '25', '2026-03-01', '2027-01-01', 'doc-1', 'n'],
    ]);
    expect((await links.sublabelTerms({ sublabelId: one })).map((r) => [r.isrc, r.percent])).toEqual([
      [A, '50'],
      [B, '25'],
    ]);
    const bad = (t: Partial<Parameters<typeof links.addSublabelTerms>[0][number]>) =>
      links.addSublabelTerms([{ sublabelId: one, isrc: A, percent: '50', validFrom: '2026-01-01', ...t }], 'tester');
    await expect(bad({ validFrom: '2026-01-15' })).rejects.toMatchObject({ code: 'date_invalid' });
    await expect(bad({ percent: '0' })).rejects.toMatchObject({ code: 'percent_invalid' });
    await expect(bad({ percent: '100.5' })).rejects.toMatchObject({ code: 'percent_invalid' });
    await expect(bad({ isrc: 'XX' })).rejects.toMatchObject({ code: 'validation_error' });
    await expect(bad({ validTo: '2026-01-01' })).rejects.toMatchObject({ code: 'empty_period' });
    await expect(
      links.addSublabelTerms(
        [
          { sublabelId: one, isrc: B, percent: '50', validFrom: '2028-01-01' },
          { sublabelId: one, isrc: B, percent: '50', validFrom: '2029-01-01' },
        ],
        'tester',
      ),
    ).rejects.toMatchObject({ code: 'duplicate_in_request' });
  });

  it('a new term closes the open one at its start (a buyout, a move); an earlier start is term_overlap, all or nothing', async () => {
    const { links, one, two } = await world();
    await links.addSublabelTerms([{ sublabelId: one, isrc: A, percent: '50', validFrom: '2025-11-01' }], 'tester');
    await links.addSublabelTerms([{ sublabelId: one, isrc: A, percent: '25', validFrom: '2026-09-01' }], 'tester');
    await links.addSublabelTerms([{ sublabelId: two, isrc: A, percent: '50', validFrom: '2027-01-01' }], 'tester');
    expect((await links.sublabelTerms({ isrcs: [A] })).map((r) => [r.sublabelId, r.percent, r.validFrom, r.validTo])).toEqual([
      [one, '50', '2025-11-01', '2026-09-01'],
      [one, '25', '2026-09-01', '2027-01-01'],
      [two, '50', '2027-01-01', null],
    ]);
    // a start on or before a live start, in one batch with a valid row: nothing is written
    await expect(
      links.addSublabelTerms(
        [
          { sublabelId: one, isrc: B, percent: '50', validFrom: '2026-01-01' },
          { sublabelId: one, isrc: A, percent: '50', validFrom: '2027-01-01' },
        ],
        'tester',
      ),
    ).rejects.toMatchObject({ code: 'term_overlap' });
    expect(await links.sublabelTerms({ isrcs: [B] })).toEqual([]);
    expect((await links.sublabelTerms({ isrcs: [A] }))[2]?.validTo).toBeNull();
  });

  it('closes an open term; a start inside a closed term is term_overlap, after it a new term opens', async () => {
    const { links, one } = await world();
    const [t] = await links.addSublabelTerms([{ sublabelId: one, isrc: A, percent: '50', validFrom: '2025-11-01' }], 'tester');
    const closed = await links.closeSublabelTerm(t!.id, '2026-06-01');
    expect(closed.validTo).toBe('2026-06-01');
    await expect(links.closeSublabelTerm(t!.id, '2026-08-01')).rejects.toMatchObject({ code: 'term_closed' });
    await expect(
      links.addSublabelTerms([{ sublabelId: one, isrc: A, percent: '50', validFrom: '2026-03-01' }], 'tester'),
    ).rejects.toMatchObject({ code: 'term_overlap' });
    await links.addSublabelTerms([{ sublabelId: one, isrc: A, percent: '50', validFrom: '2026-08-01' }], 'tester');
    expect((await links.sublabelTerms({ isrcs: [A] })).map((r) => [r.validFrom, r.validTo])).toEqual([
      ['2025-11-01', '2026-06-01'],
      ['2026-08-01', null],
    ]);
    const [u] = await links.addSublabelTerms([{ sublabelId: one, isrc: B, percent: '50', validFrom: '2026-01-01' }], 'tester');
    await expect(links.closeSublabelTerm(u!.id, '2026-01-01')).rejects.toMatchObject({ code: 'empty_period' });
  });

  it('cancels only the latest term of an ISRC and opens again the one it had closed; the row stays', async () => {
    const { links, one, two } = await world();
    const [first] = await links.addSublabelTerms([{ sublabelId: one, isrc: A, percent: '50', validFrom: '2025-11-01' }], 'tester');
    const [second] = await links.addSublabelTerms([{ sublabelId: two, isrc: A, percent: '50', validFrom: '2026-09-01' }], 'tester');
    await expect(links.cancelSublabelTerm(first!.id, 'tester', 'wrong')).rejects.toMatchObject({ code: 'term_not_last' });
    await expect(links.cancelSublabelTerm(second!.id, 'tester', ' ')).rejects.toMatchObject({ code: 'validation_error' });
    expect(await links.cancelSublabelTerm(second!.id, 'tester', 'wrong sublabel')).toEqual({ id: second!.id, reopened: first!.id });
    expect((await links.sublabelTerms({ isrcs: [A] })).map((r) => [r.sublabelId, r.validTo])).toEqual([[one, null]]);
    const all = await links.sublabelTerms({ isrcs: [A], withCancelled: true });
    expect(all.find((r) => r.id === second!.id)).toMatchObject({ cancelledBy: 'tester', cancelReason: 'wrong sublabel' });
    await expect(links.cancelSublabelTerm(second!.id, 'tester', 'again')).rejects.toMatchObject({ code: 'not_found' });
    // the same start may be used again after a cancel
    await links.addSublabelTerms([{ sublabelId: one, isrc: A, percent: '25', validFrom: '2026-09-01' }], 'tester');
  });

  it('attaches a document once to terms without one', async () => {
    const { links, one } = await world();
    const rows = await links.addSublabelTerms(
      [
        { sublabelId: one, isrc: A, percent: '50', validFrom: '2025-11-01' },
        { sublabelId: one, isrc: B, percent: '50', validFrom: '2025-11-01' },
      ],
      'tester',
    );
    const ids = rows.map((r) => r.id);
    const done = await links.attachSublabelTermDocument(ids, 'doc-9', 'lawyer');
    expect(done.map((r) => [r.documentId, r.documentBy])).toEqual([
      ['doc-9', 'lawyer'],
      ['doc-9', 'lawyer'],
    ]);
    await expect(links.attachSublabelTermDocument([ids[0]!], 'doc-10', 'lawyer')).rejects.toMatchObject({ code: 'term_has_document' });
    await expect(links.attachSublabelTermDocument(['nope'], 'doc-10', 'lawyer')).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('the actions of the sublabels (D-218)', () => {
  async function world() {
    const f = await newFacade();
    await f.modules.owners.createTrack({ title: 'Song A', isrc: A, upc: '000000000001' });
    const one = await f.createSublabel('One');
    const two = await f.createSublabel('Two');
    const appendix = (await approvedAppendix(f)).id;
    return { f, one: one.id, two: two.id, appendix };
  }

  it('classifies a batch without writing: dates floored, the catalog, every error class', async () => {
    const { f, one } = await world();
    const out = await f.addSublabelTerms(
      one,
      {
        percent: '50',
        validFrom: '2025-11-17',
        items: [
          { isrc: A },
          { isrc: 'fr-x28-26-00002', percent: '25', validFrom: '2026-03' },
          { isrc: 'bad' },
          { isrc: A },
          { isrc: 'FRX282600003', percent: '0' },
          { isrc: 'FRX282600004', validFrom: '2026-13-01' },
          { isrc: 'FRX282600005', validTo: '2025-11-20' },
        ],
      },
      { dryRun: true },
      'tester',
    );
    expect(out.applied).toBe(false);
    expect(out.rows.map((r) => [r.isrc, r.kind, r.error, r.validFrom, r.notInCatalog, r.title])).toEqual([
      [A, 'new', null, '2025-11-01', false, 'Song A'],
      [B, 'new', null, '2026-03-01', true, null],
      ['BAD', 'error', 'isrc_invalid', null, false, null],
      [A, 'error', 'duplicate_in_request', null, false, 'Song A'],
      ['FRX282600003', 'error', 'percent_invalid', null, false, null],
      ['FRX282600004', 'error', 'date_invalid', null, false, null],
      ['FRX282600005', 'error', 'empty_period', '2025-11-01', false, null],
    ]);
    expect(out.totals).toEqual({ rows: 7, new: 2, closes: 0, unchanged: 0, errors: 5, notInCatalog: 1 });
    expect(await f.modules.links.sublabelTerms()).toEqual([]);
    // the apply of the same batch refuses as a whole
    await expect(f.addSublabelTerms(one, { percent: '50', validFrom: '2025-11', items: [{ isrc: A }, { isrc: 'bad' }] }, { dryRun: false }, 'tester')).rejects.toMatchObject({
      code: 'terms_invalid',
      details: { rows: [{ line: 2, isrc: 'BAD', code: 'isrc_invalid' }], errors: 1 },
    });
    expect(await f.modules.links.sublabelTerms()).toEqual([]);
  });

  it('applies: a repeat is unchanged, a buyout and a move close the open term, an earlier start is an error row', async () => {
    const { f, one, two, appendix } = await world();
    const first = await f.addSublabelTerms(one, { percent: '50', validFrom: '2025-11', documentId: appendix, items: [{ isrc: A }, { isrc: B }] }, { dryRun: false }, 'tester');
    expect([first.applied, first.termIds.length]).toEqual([true, 2]);
    const again = await f.addSublabelTerms(one, { percent: '50', validFrom: '2025-11', documentId: appendix, items: [{ isrc: A }] }, { dryRun: false }, 'tester');
    expect([again.rows[0]?.kind, again.termIds]).toEqual(['unchanged', []]);
    const preview = await f.addSublabelTerms(
      two,
      { percent: '50', validFrom: '2026-09', items: [{ isrc: A }, { isrc: B, validFrom: '2025-10' }] },
      { dryRun: true },
      'tester',
    );
    expect(preview.rows.map((r) => [r.kind, r.error, r.closes?.sublabelName ?? null, r.closes?.percent ?? null])).toEqual([
      ['closes', null, 'One', '50'],
      ['error', 'term_overlap', null, null],
    ]);
    await f.addSublabelTerms(one, { percent: '25', validFrom: '2026-03', items: [{ isrc: B }] }, { dryRun: false }, 'tester');
    const terms = await f.listSublabelTerms({ isrc: B });
    expect(terms.map((t) => [t.sublabelName, t.percent, t.validFrom, t.validTo, t.documentStatus])).toEqual([
      ['One', '50', '2025-11-01', '2026-03-01', 'approved'],
      ['One', '25', '2026-03-01', null, null],
    ]);
    expect((await f.listSublabelTerms({ sublabel: one, month: '2026-01' })).map((t) => t.isrc)).toEqual([A, B]);
    expect((await f.listSublabelTerms({ noDocument: true })).map((t) => [t.isrc, t.percent])).toEqual([[B, '25']]);
    const list = await f.listSublabels();
    expect(list.map((s) => [s.name, s.withoutDocument])).toEqual([
      ['One', 1],
      ['Two', 0],
    ]);
  });

  it('closes from a floored month, cancels the latest, attaches a document of a split kind only', async () => {
    const { f, one, appendix } = await world();
    const { termIds } = await f.addSublabelTerms(one, { percent: '50', validFrom: '2025-11', items: [{ isrc: A }] }, { dryRun: false }, 'tester');
    const id = termIds[0] as string;
    expect((await f.closeSublabelTerm(id, '2026-06-20')).validTo).toBe('2026-06-01');
    expect((await f.listSublabelTerms({ isrc: A }))[0]?.state).toBe('closed');
    const payment = await f.modules.owners.createDocument({ kind: 'payment_proof', title: 'Proof', fileRef: 'dummy://p.pdf', requiresApproval: false });
    await expect(f.attachSublabelTermsDocument([id], payment.id, 'tester')).rejects.toMatchObject({ code: 'document_kind' });
    await expect(f.attachSublabelTermsDocument([id], 'nope', 'tester')).rejects.toMatchObject({ code: 'not_found' });
    expect((await f.attachSublabelTermsDocument([id], appendix, 'tester'))[0]?.documentId).toBe(appendix);
    await expect(
      f.addSublabelTerms(one, { percent: '50', validFrom: '2025-11', documentId: payment.id, items: [{ isrc: B }] }, { dryRun: true }, 'tester'),
    ).rejects.toMatchObject({ code: 'document_kind' });
    await expect(f.addSublabelTerms('nope', { percent: '50', validFrom: '2025-11', items: [{ isrc: B }] }, { dryRun: true }, 'tester')).rejects.toMatchObject({ code: 'not_found' });
    expect(await f.cancelSublabelTerm(id, 'tester', 'mistake')).toEqual({ id, reopened: null });
    expect((await f.listSublabelTerms({ isrc: A, withCancelled: true }))[0]?.state).toBe('cancelled');
  });
});
