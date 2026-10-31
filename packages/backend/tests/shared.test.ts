import { describe, expect, it } from 'vitest';
import { assertIsrc, normalizeIsrc, normalizeUpc } from '../src/shared/identifiers';
import { Decimal, floorToCents, parsePico, picoToString } from '../src/shared/money';
import { quarterEndMonth } from '../src/shared/dates';

describe('keys and normalization (README 5)', () => {
  it('ISRC has no dashes and is upper case', () => {
    expect(normalizeIsrc(' us-abc-26-00001 ')).toBe('USABC2600001');
    expect(assertIsrc('fr-x45-26-12345')).toBe('FRX452612345');
    expect(() => assertIsrc('not-an-isrc')).toThrow();
    expect(normalizeUpc(' 0 123-456 ')).toBe('0123456');
  });
});

describe('money (README 5): USD, full precision, no floats, rounding only at payout', () => {
  it('keeps 12 decimals exactly', () => {
    expect(picoToString(parsePico('0.005715970307'))).toBe('0.005715970307');
    expect(picoToString(parsePico('-12.5'))).toBe('-12.5');
    // 0.1 + 0.2 is exact in pico integers
    expect(picoToString(parsePico('0.1') + parsePico('0.2'))).toBe('0.3');
  });
  it('rejects more than 12 decimals instead of rounding silently', () => {
    expect(() => parsePico('0.0000000000001')).toThrow(/12 decimals/);
    expect(picoToString(parsePico('1.13E-10'))).toBe('0.000000000113');
  });
  it('payout rounds down to cents', () => {
    expect(floorToCents(new Decimal('100.009999'))).toBe(10000);
    expect(floorToCents(new Decimal('0.019'))).toBe(1);
  });
  it('quarter is dated by its last month', () => {
    expect(quarterEndMonth('2026-Q2')).toBe('2026-06');
  });
});
