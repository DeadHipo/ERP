import { describe, expect, it } from 'vitest';
import { Decimal } from '../../src/shared/money';
import {
  allocateLine,
  PUBLISHING_LAYERS,
  type PublishingContext,
  type PublishingLine,
  type PublishingTerm,
  type PublishingWriter,
} from '../../src/facade/layers';

// The pure publishing layers (D-128 part 2, 12 G26a-d): no stack, hand-built context. Synthetic data only.

const writer = (name: string, ownerId: string | null, resolution = 'matched'): PublishingWriter => ({
  writerNorm: name.toLowerCase(),
  displayName: name,
  ownerId,
  resolution,
});
const term = (
  ownerId: string,
  percent: string,
  operationType: string | null = null,
  extra: Partial<PublishingTerm> = {},
): PublishingTerm => ({
  id: `t-${ownerId}-${percent}-${operationType ?? 'any'}`,
  ownerId,
  percent,
  validFrom: '2020-01-01',
  validTo: null,
  documentId: 'ok',
  operationType,
  ...extra,
});

function ctx(
  o: Partial<Omit<PublishingContext, 'writers'>> & { writers?: PublishingWriter[] } = {},
): PublishingContext {
  const writers = o.writers ?? [writer('w1', 'o1'), writer('w2', 'o2'), writer('w3', 'o3')];
  return {
    writers: new Map(writers.map((w) => [w.writerNorm, w])),
    terms: o.terms ?? [term('o1', '50'), term('o2', '90'), term('o2', '50', 'Synchronization')],
    resolveOwner: o.resolveOwner ?? ((id) => id),
    labelOwners: o.labelOwners ?? new Set(),
    confirmedOwners: o.confirmedOwners ?? new Set(['o1', 'o2', 'o3', 'o4']),
    documentStatus:
      o.documentStatus ?? ((id) => (id === 'ok' ? 'approved' : id ? 'not_approved' : 'missing')),
  };
}
const line = (
  songwriters: string | null,
  payable: string,
  operationType: string | null = 'Mechanical',
): PublishingLine => ({
  period: '2026-Q1',
  reportMonth: '2026-03',
  writerNorm: 'h',
  writerName: 'H',
  workTitle: 'T',
  songwriters,
  operationType,
  payable: new Decimal(payable),
});
const run = (l: PublishingLine, c: PublishingContext) =>
  allocateLine(l, c).parts.map((p) => ({
    w: p.writerName,
    owner: p.ownerId,
    part: p.payable.toFixed(),
    pct: p.percent.toFixed(),
    author: p.authorAmount.toFixed(),
    label: p.labelAmount.toFixed(),
    cat: p.category,
    reason: p.reason,
  }));

describe('publishing layers', () => {
  it('the order is writer parts, author share, categorise', () => {
    expect(PUBLISHING_LAYERS.map((l) => l.name)).toEqual([
      'writer-parts',
      'author-share',
      'publishing-categorise',
    ]);
  });

  it('G26a: equal parts, the untyped term for Mechanical', () => {
    expect(run(line('w1, w2', '100'), ctx())).toEqual([
      { w: 'w1', owner: 'o1', part: '50', pct: '50', author: '25', label: '25', cat: 'B', reason: null },
      { w: 'w2', owner: 'o2', part: '50', pct: '90', author: '45', label: '5', cat: 'B', reason: null },
    ]);
  });

  it('G26b: a typed term wins for its type', () => {
    expect(
      run(line('w1, w2', '100', 'Synchronization'), ctx()).map((p) => [p.pct, p.author, p.label]),
    ).toEqual([
      ['50', '25', '25'],
      ['50', '25', '25'],
    ]);
  });

  it('a line without a type uses only the untyped term', () => {
    expect(run(line('w2', '100', null), ctx()).map((p) => p.pct)).toEqual(['90']);
  });

  it('G26c: an external co-writer takes nothing', () => {
    expect(run(line('w1, x', '100'), ctx())).toEqual([
      { w: 'w1', owner: 'o1', part: '100', pct: '50', author: '50', label: '50', cat: 'B', reason: null },
    ]);
  });

  it('G26d: no terms means the default 50 and C publishing_terms_unconfirmed', () => {
    expect(run(line('w3', '100'), ctx())).toEqual([
      {
        w: 'w3',
        owner: 'o3',
        part: '100',
        pct: '50',
        author: '50',
        label: '50',
        cat: 'C',
        reason: 'publishing_terms_unconfirmed',
      },
    ]);
  });

  it('three writers: parts cut at 20 decimals, the last takes the remainder, the parts add up', () => {
    const c = ctx({ writers: [writer('w1', 'o1'), writer('w2', 'o2'), writer('w3', 'o3')] });
    const parts = allocateLine(line('w1, w2, w3', '100'), c).parts;
    expect(parts.map((p) => p.payable.toFixed())).toEqual([
      '33.33333333333333333333',
      '33.33333333333333333333',
      '33.33333333333333333334',
    ]);
    expect(parts.reduce((s, p) => s.add(p.payable), new Decimal(0)).toFixed()).toBe('100');
  });

  it('an ambiguous writer keeps a part with owner null (C writer_unmapped, nothing accrued)', () => {
    const c = ctx({ writers: [writer('w1', 'o1'), writer('w2', null, 'ambiguous')] });
    expect(run(line('w1, w2', '100'), c)).toEqual([
      { w: 'w1', owner: 'o1', part: '50', pct: '50', author: '25', label: '25', cat: 'B', reason: null },
      {
        w: 'w2',
        owner: null,
        part: '50',
        pct: '50',
        author: '0',
        label: '0',
        cat: 'C',
        reason: 'writer_unmapped',
      },
    ]);
  });

  it('no writer of ours: the line goes to the rights-holder', () => {
    const c = ctx({ writers: [writer('h', 'o1')] });
    expect(run(line('x, y', '100'), c).map((p) => [p.w, p.owner, p.part])).toEqual([['H', 'o1', '100']]);
    expect(run(line(null, '100'), c).map((p) => p.owner)).toEqual(['o1']);
    expect(run(line(null, '100'), ctx({ writers: [] })).map((p) => [p.owner, p.reason])).toEqual([
      [null, 'writer_unmapped'],
    ]);
  });

  it('a label owner counts as unmapped', () => {
    const c = ctx({ labelOwners: new Set(['o1']) });
    expect(run(line('w1', '100'), c)).toMatchObject([
      { owner: null, author: '0', label: '0', reason: 'writer_unmapped' },
    ]);
  });

  it('an unconfirmed owner is owner_unconfirmed; an unapproved terms document is publishing_terms_unconfirmed', () => {
    expect(run(line('w1', '100'), ctx({ confirmedOwners: new Set() }))[0]?.reason).toBe('owner_unconfirmed');
    const c = ctx({ terms: [term('o1', '50', null, { documentId: 'no' })] });
    expect(run(line('w1', '100'), c)[0]?.reason).toBe('publishing_terms_unconfirmed');
  });

  it('terms are chosen at the quarter-end month, valid_to exclusive; merged owners resolve', () => {
    const c = ctx({
      terms: [
        term('o1', '40', null, { validTo: '2026-03-01' }),
        term('o1', '60', null, { validFrom: '2026-03-01' }),
      ],
    });
    expect(run(line('w1', '100'), c)[0]?.pct).toBe('60');
    const merged = ctx({
      writers: [writer('w1', 'old')],
      terms: [term('o1', '70')],
      resolveOwner: (id) => (id === 'old' ? 'o1' : id),
    });
    expect(run(line('w1', '100'), merged)[0]).toMatchObject({ owner: 'o1', pct: '70' });
  });
});
