import { describe, expect, it } from 'vitest';
import { parseBatch } from '../src/pages/ads/parse-batch';

describe('parseBatch: the pasted list of advertising expenses', () => {
  it('reads semicolons and tabs, a decimal comma, the default percent, and leaves out a header and empty lines', () => {
    const rows = parseBatch('ISRC;Месяц;Сумма\nqztst2600001;2026-07;12,50\n\nQZ-TST-26-00002\t2026-08\t1 040.00\t50\thttps://post\tпромо');
    expect(rows).toEqual([
      { line: 2, isrc: 'QZTST2600001', month: '2026-07', amount: '12.50', recoveryPercent: '100', externalRef: '', comment: '', error: null },
      { line: 4, isrc: 'QZTST2600002', month: '2026-08', amount: '1040.00', recoveryPercent: '50', externalRef: 'https://post', comment: 'промо', error: null },
    ]);
  });

  it('names the first wrong column of a line', () => {
    const errors = (t: string) => parseBatch(t).map((r) => r.error);
    expect(errors('QZTST2600001;2026-07')).toEqual(['columns']);
    expect(errors('nope;2026-07;1')).toEqual(['isrc']);
    expect(errors('QZTST2600001;2026-13;1')).toEqual(['month']);
    expect(errors('QZTST2600001;2026-07;0')).toEqual(['amount']);
    expect(errors('QZTST2600001;2026-07;1.234')).toEqual(['amount']);
    expect(errors('QZTST2600001;2026-07;1;101')).toEqual(['percent']);
  });
});
