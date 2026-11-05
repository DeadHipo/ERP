import { describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { quartersFromFileName } from '../src/modules/publishing';
import {
  approvedAppendix,
  approvedDoc,
  confirmedOwner,
  newFacade,
  tmpPath,
  writeB17,
  writeBelieve,
} from './helpers/fixtures';
import { testFileTotals, testQuery } from './helpers/test-sources';

// README section 5 rules that the coverage check of 2026-10-31 found only partly covered (D-096).

const I1 = 'QZTST2600101';
const UPC = '1234567890123';

describe('README 5: Believe line key', () => {
  it('release type is a key dimension; gross and quantity are summed for identical keys', async () => {
    const f = await newFacade();
    const base = { isrc: I1, upc: UPC, net: '1', gross: '2', quantity: 3 };
    const loaded = await f.ingestBelieve(
      writeBelieve('2026-07', [base, { ...base }, { ...base, releaseType: 'Video Release' }]), f.testLabels['0to8'],
    );
    expect(loaded.lineCount).toBe(3);
    expect((await testFileTotals(loaded.id)).keys).toBe('2');
    expect(loaded.grossTotal?.toString()).toBe('6');
    // the `lines` view gives one record per key: quantity summed, the number of merged lines kept
    const rows = await testQuery(
      (db) =>
        `SELECT release_type AS t, toString(quantity) AS q, toString(merged_lines) AS n FROM ${db}.lines ORDER BY t`,
    );
    expect(rows).toEqual([
      { t: 'Music Release', q: '6', n: '2' },
      { t: 'Video Release', q: '3', n: '1' },
    ]);
  });

  it('account is part of the scope: two accounts load the same month; the same account twice is refused', async () => {
    const f = await newFacade();
    const rows = (net: string) => [{ isrc: I1, upc: UPC, net }];
    await f.ingestBelieve(writeBelieve('2026-07', rows('1'), { account: '1052428', reportId: '9000011' }), f.testLabels['0to8']);
    await f.ingestBelieve(writeBelieve('2026-07', rows('2'), { account: '1055956', reportId: '9000012' }), f.testLabels.Echo8);
    await expect(
      f.ingestBelieve(writeBelieve('2026-07', rows('3'), { account: '1055956', reportId: '9000013' }), f.testLabels.Echo8),
    ).rejects.toThrow(/already loaded/);
    expect(await f.modules.sources.listFiles()).toHaveLength(2);
  });
});

describe('README 5: splits have one level only', () => {
  it('a share is always an artist: an owner or label id is not accepted as a share', async () => {
    const f = await newFacade();
    const { owner } = await confirmedOwner(f, 'Owner One', ['One']);
    await expect(
      async () =>
        await f.createSplit({
          isrc: I1,
          validFrom: '2026-01-01',
          shares: [{ artistId: owner.id, percent: '50' }],
        }),
    ).rejects.toThrow(/not found/i);
  });
});

describe('README 5: buyout payment is not part of the balance', () => {
  it('after a buyout the seller has no payout, recoupment or operation from it', async () => {
    const f = await newFacade();
    const { owner, artists } = await confirmedOwner(f, 'Seller Owner', ['Seller']);
    const sellerId = artists[0]?.id as string;
    const s = await f.createSplit({
      isrc: I1,
      validFrom: '2026-01-01',
      shares: [{ artistId: sellerId, percent: '50' }],
    });
    await f.confirmSplit(s.id, (await approvedAppendix(f)).id);
    await f.modules.owners.createTrack({ isrc: I1, upc: UPC, artistIds: [sellerId], title: 'T' });
    await f.buyout({
      isrcs: [I1],
      sellerArtistId: sellerId,
      effectiveFrom: '2026-07-01',
      documentId: (await approvedDoc(f, 'buyout')).id,
    });
    await f.ingestBelieve(writeBelieve('2026-07', [{ isrc: I1, upc: UPC, net: '100' }]), f.testLabels['0to8']);
    const b = await f.ownerBalance(owner.id);
    expect(await f.modules.settlements.listOperations({ ownerId: owner.id })).toHaveLength(0);
    expect(b.total.paid.toFixed()).toBe('0');
    expect(b.total.recouped.toFixed()).toBe('0');
    expect(b.total.earned.toFixed()).toBe('0');
  });
});

describe('README 5: operations', () => {
  it('in/out with a signed amount and optional fields; no operation type is stored', async () => {
    const f = await newFacade();
    const { owner, artists } = await confirmedOwner(f, 'Ops Owner', ['Ops']);
    const op = await f.createOperation({ labelId: f.testLabels['0to8'],
      direction: 'in',
      amount: '12.34',
      artistId: artists[0]?.id as string,
      ownerId: owner.id,
      date: '2026-08-01',
      period: '2026-07',
      scope: { kind: 'isrcs', isrcs: [I1] },
      documentId: (await approvedDoc(f, 'adjustment_basis', owner.id)).id,
      comment: 'synthetic deduction',
    });
    const stored = (await f.modules.settlements.listOperations({ ownerId: owner.id }))[0];
    expect(stored).toMatchObject({ direction: 'in', amountCents: 1234, period: '2026-07' });
    expect(stored?.scope).toEqual({ kind: 'isrcs', isrcs: [I1] });
    expect(Object.keys(op)).not.toContain('type');
    expect(Object.keys(stored ?? {})).not.toContain('type');
  });

  it('an outgoing operation without a scope is a plain payout and only the payout button makes one', async () => {
    const f = await newFacade();
    const { owner, artists } = await confirmedOwner(f, 'Scope Owner', ['Scope']);
    await expect(
      async () =>
        await f.createOperation({ labelId: f.testLabels['0to8'],
          direction: 'out',
          amount: '50',
          artistId: artists[0]?.id as string,
          ownerId: owner.id,
          date: '2026-08-01',
          documentId: (await approvedDoc(f, 'advance_basis', owner.id)).id,
          comment: 'advance without scope',
        }),
    ).rejects.toThrow(/payout button/i);
  });
});

describe('README 5: B17 amount column', () => {
  it('Total Payable is used, not the net amount column', async () => {
    const f = await newFacade();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Detail');
    ws.addRow([
      'Period',
      'asset title',
      'rights-holder name',
      'songwriters',
      'net amount',
      'Withholding',
      'Total Payable',
    ]);
    ws.addRow(['2Q26', 'Song', 'Synthetic Holder', '', 999, 989, 10]);
    const path = tmpPath('0to8_Q22026_Publishing_Statement.xlsx');
    await wb.xlsx.writeFile(path);
    const r = await f.ingestB17({ path, fileName: '0to8_Q22026_Publishing_Statement.xlsx' }, f.testLabels['0to8']);
    expect(r.statement.totalPayable.toString()).toBe('10');
  });

  it('the author gets the contract percent of Total Payable and the label keeps the rest', async () => {
    const f = await newFacade();
    const { owner } = await confirmedOwner(f, 'Writer Owner', ['Writer']);
    await f.modules.owners.addOwnerAlias(owner.id, 'Synthetic Writer');
    await f.setPublishingTerms({
      ownerId: owner.id,
      percent: '70',
      validFrom: '2020-01-01',
      documentId: (await approvedDoc(f, 'contract', owner.id)).id,
    });
    await f.ingestB17(await writeB17('Q22026', [{ writer: 'Synthetic Writer', title: 'S', payable: '100' }]), f.testLabels['0to8']);
    await f.resolveWriters();
    expect((await f.ownerBalance(owner.id)).total.earned.toFixed()).toBe('70');
  });
});

describe('README 5: period filter', () => {
  it('the period filter uses the report date by default; the sales date only on request', async () => {
    const f = await newFacade();
    const { owner, artists } = await confirmedOwner(f, 'Period Owner', ['Period']);
    const id = artists[0]?.id as string;
    const s = await f.createSplit({
      isrc: I1,
      validFrom: '2026-01-01',
      shares: [{ artistId: id, percent: '50' }],
    });
    await f.confirmSplit(s.id, (await approvedAppendix(f)).id);
    await f.modules.owners.createTrack({ isrc: I1, upc: UPC, artistIds: [id], title: 'T' });
    await f.ingestBelieve(
      writeBelieve('2026-07', [{ isrc: I1, upc: UPC, net: '100', salesMonth: '2026-05' }]), f.testLabels['0to8'],
    );
    const byDefault = await f.ownerBalance(owner.id, { from: '2026-07', to: '2026-07' });
    expect(byDefault.period?.basis).toBe('report');
    expect(byDefault.period?.received.toFixed()).toBe('100');
    const bySales = await f.ownerBalance(owner.id, { from: '2026-07', to: '2026-07', basis: 'sales' });
    expect(bySales.period?.received.toFixed()).toBe('0');
  });
});

describe('README 5: no floats in money', () => {
  // Every Number(...) in src must be one of these non-money values (counts, row ids, settings, a quarter month).
  const NUMBER_ALLOWED = [
    'Number(process.env.PORT',
    'Number(process.env.PAYOUT_THRESHOLD_CENTS',
    // connection settings of PostgreSQL and ClickHouse (ports, pool sizes), not money
    'Number(env.DB_PORT',
    'Number(env.DB_POOL_MAX',
    'Number(r.line_count', // a count of report lines from the registry, not money
    'Number(env.CLICKHOUSE_MAX_CONNECTIONS',
    'Number(qty)',
    'Number(b.quantity)',
    'Number(insertAttr.run(hash, attrs)',
    'Number(check.n)',
    'Number(totals.lines)',
    'Number(totals.keys)',
    'Number(m[2])',
  ];
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : [],
    );

  it('the source never parses or rounds money as a float', async () => {
    const offenders: string[] = [];
    for (const file of files(join(process.cwd(), 'src'))) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/parseFloat\(|Math\.(round|floor|ceil|trunc)\(|toPrecision\(/g))
        offenders.push(`${file}: ${m[0]}`);
      for (const m of text.matchAll(/\bNumber\([^)]*\)?/g))
        if (!NUMBER_ALLOWED.some((a) => m[0].startsWith(a))) offenders.push(`${file}: ${m[0]}`);
    }
    expect(offenders).toEqual([]);
  });

  it('balance, reconciliation and payout snapshot carry money as decimal strings or whole cents only', async () => {
    const f = await newFacade();
    const { owner, artists } = await confirmedOwner(f, 'Float Owner', ['Float']);
    const id = artists[0]?.id as string;
    const s = await f.createSplit({
      isrc: I1,
      validFrom: '2026-01-01',
      shares: [{ artistId: id, percent: '33.333333' }],
    });
    await f.confirmSplit(s.id, (await approvedAppendix(f)).id);
    await f.modules.owners.createTrack({ isrc: I1, upc: UPC, artistIds: [id], title: 'T' });
    await f.ingestBelieve(
      writeBelieve('2026-07', [
        { isrc: I1, upc: UPC, net: '0.1' },
        { isrc: I1, upc: UPC, net: '0.2', country: 'Peru' },
        { isrc: I1, upc: UPC, net: '1000.000000000001', country: 'Chile' },
      ]), f.testLabels['0to8'],
    );
    const payout = await f.createPayout(owner.id, { labelId: f.testLabels['0to8'] });
    const fractional: string[] = [];
    const walk = (v: unknown, path: string) => {
      if (typeof v === 'number' && !Number.isInteger(v)) fractional.push(`${path}=${v}`);
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
    };
    const json = (x: unknown) => JSON.parse(JSON.stringify(x)) as unknown;
    walk(json(await f.ownerBalance(owner.id)), 'balance');
    walk(json(await f.reconciliation()), 'reconciliation');
    walk(json(await f.modules.settlements.getSnapshot(payout.id)), 'snapshot');
    expect(fractional).toEqual([]);
    // exact: (0.1 + 0.2 + 1000.000000000001) x 0.33333333, paid rounded down to whole cents
    expect(Number.isInteger(payout.amountCents)).toBe(true);
    expect((await f.ownerBalance(owner.id)).total.earned.toFixed()).toBe('333.433329999');
  });
});

describe('README 5: key dimensions account and reporting month', () => {
  it('identical lines in two accounts or two reporting months stay separate units and are not merged', async () => {
    const f = await newFacade();
    const line = (net: string) => [{ isrc: I1, upc: UPC, net, salesMonth: '2026-06' }];
    await f.ingestBelieve(writeBelieve('2026-07', line('1'), { account: '1052428', reportId: '9000021' }), f.testLabels['0to8']);
    await f.ingestBelieve(writeBelieve('2026-07', line('2'), { account: '1055956', reportId: '9000022' }), f.testLabels.Echo8);
    await f.ingestBelieve(writeBelieve('2026-08', line('4'), { account: '1052428', reportId: '9000023' }), f.testLabels['0to8']);
    const units = (await f.modules.sources.units())
      .map((u) => [u.account, u.reportingMonth, u.netPico.toString()])
      .sort();
    expect(units).toEqual([
      ['1052428', '2026-07', '1000000000000'],
      ['1052428', '2026-08', '4000000000000'],
      ['1055956', '2026-07', '2000000000000'],
    ]);
    // three files, three keys: identical lines of different files are not merged
    expect(await testQuery((db) => `SELECT toString(count()) AS n FROM ${db}.lines`)).toEqual([{ n: '3' }]);
  });
});

describe('README 5: recalculated from scratch for the period and "today"', () => {
  it('nothing is stored: the all-time view follows the data present at the moment of the call', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-15T10:00:00Z'));
    try {
      const f = await newFacade();
      const { owner, artists } = await confirmedOwner(f, 'Today Owner', ['Today']);
      const id = artists[0]?.id as string;
      const s = await f.createSplit({
        isrc: I1,
        validFrom: '2026-01-01',
        shares: [{ artistId: id, percent: '50' }],
      });
      await f.confirmSplit(s.id, (await approvedAppendix(f)).id);
      await f.modules.owners.createTrack({ isrc: I1, upc: UPC, artistIds: [id], title: 'T' });
      await f.ingestBelieve(writeBelieve('2026-07', [{ isrc: I1, upc: UPC, net: '100' }]), f.testLabels['0to8']);
      expect((await f.ownerBalance(owner.id)).total.payable.toFixed()).toBe('50');
      // a later report changes "today" at once; the July period view does not move
      await f.ingestBelieve(
        writeBelieve('2026-08', [{ isrc: I1, upc: UPC, net: '20' }], { reportId: '9000031' }), f.testLabels['0to8'],
      );
      expect((await f.ownerBalance(owner.id)).total.payable.toFixed()).toBe('60');
      expect(
        (await f.ownerBalance(owner.id, { from: '2026-07', to: '2026-07' })).period?.received.toFixed(),
      ).toBe('100');
      // the payout is dated today and counts as soon as its proof exists
      const p = await f.createPayout(owner.id, { labelId: f.testLabels['0to8'] });
      expect(p.date).toBe('2026-09-15');
      await f.attachPaymentProof(p.id, { fileRef: 'dummy://proof' });
      expect((await f.ownerBalance(owner.id)).total.payable.toFixed()).toBe('0');
      // the only stored record is the payout operation itself; balances are never stored
      expect(
        (await f.modules.settlements.listOperations({ ownerId: owner.id })).map((o) => o.amountCents),
      ).toEqual([6000]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('README 5: payout snapshot and B17 file names (D-100)', () => {
  it('the payout snapshot stores the hashes of the B17 statements as well as the Believe files', async () => {
    const f = await newFacade();
    const { owner, artists } = await confirmedOwner(f, 'Snapshot Owner', ['Snap']);
    // a payout is made under a label (D-168) and publishing has none: the owner needs master income under 0to8
    await f.modules.owners.createTrack({ title: 't', isrc: I1, upc: UPC });
    await f.createSplit({ isrc: I1, validFrom: '2020-01-01', shares: [{ artistId: (artists[0] as { id: string }).id, percent: '50' }], documentId: (await approvedAppendix(f)).id });
    await f.ingestBelieve(writeBelieve('2026-07', [{ isrc: I1, upc: UPC, net: '100' }]), f.testLabels['0to8']);
    await f.modules.owners.addOwnerAlias(owner.id, 'Snapshot Writer');
    await f.setPublishingTerms({
      ownerId: owner.id,
      percent: '50',
      validFrom: '2020-01-01',
      documentId: (await approvedDoc(f, 'contract', owner.id)).id,
    });
    const r = await f.ingestB17(
      await writeB17('Q22026', [{ writer: 'Snapshot Writer', title: 'S', payable: '40' }]), f.testLabels['0to8'],
    );
    await f.resolveWriters();
    const payout = await f.createPayout(owner.id, { labelId: f.testLabels['0to8'] });
    const snap = (await f.modules.settlements.getSnapshot(payout.id)) as {
      files: { b17: { sha256: string }[] };
    };
    expect(snap.files.b17[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(snap.files.b17[0]?.sha256).toBe(r.statement.sha256);
  });

  it('a quarter in a B17 file name must stand alone', async () => {
    expect(quartersFromFileName('0to8_Q42024_Q12025_Publishing_Breakdown.xlsx')).toEqual([
      '2024-Q4',
      '2025-Q1',
    ]);
    expect(quartersFromFileName('0to8_2Q26_Statement.xlsx')).toEqual(['2026-Q2']);
    expect(quartersFromFileName('report_Q120265.xlsx')).toEqual([]);
    expect(quartersFromFileName('AQ12026.xlsx')).toEqual([]);
  });
});
