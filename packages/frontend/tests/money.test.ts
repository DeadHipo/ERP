import { describe, expect, it } from 'vitest';
import { formatMoney, isNegativeText } from '../src/lib/money';

// ru-RU groups with a no-break space (U+00A0 or U+202F) and writes the minus as U+2212 in some ICU versions.
const norm = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ').replace(/\u2212/g, '-');

describe('formatMoney', () => {
  const cases: [string, string][] = [
    ['4.165', '4,17'],
    ['999.995', '1 000,00'],
    ['-0.004', '0,00'],
    ['-21.25', '-21,25'],
    ['12.266666666666', '12,27'],
    ['0', '0,00'],
    ['19.125', '19,13'],
    ['1234.567', '1 234,57'],
    ['100', '100,00'],
  ];
  it.each(cases)('%s -> %s', (input, expected) => {
    expect(norm(formatMoney(input))).toBe(expected);
  });

  it('rounds the exact decimal string, not a float (halfExpand)', () => {
    // 1.005 is below 1.005 as a binary float; as a decimal string it is exactly a half and rounds up.
    expect(norm(formatMoney('1.005'))).toBe('1,01');
    expect(norm(formatMoney('0.125'))).toBe('0,13');
  });

  it('keeps digits a double cannot hold', () => {
    expect(norm(formatMoney('12345678901234567.89'))).toBe('12 345 678 901 234 567,89');
  });

  it('marks only a real negative as negative', () => {
    expect(isNegativeText(formatMoney('-21.25'))).toBe(true);
    expect(isNegativeText(formatMoney('-0.004'))).toBe(false);
    expect(isNegativeText(formatMoney('21.25'))).toBe(false);
  });
});
