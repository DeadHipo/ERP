import { describe, expect, it } from 'vitest';
import { centsToText } from '../src/pages/owners/components/cents';

describe('centsToText', () => {
  it.each([
    [500, '5.00'],
    [-5500, '-55.00'],
    [7, '0.07'],
    [0, '0.00'],
    [100000, '1000.00'],
  ])('%i cents is %s', (cents, text) => {
    expect(centsToText(cents)).toBe(text);
  });
});
