import { describe, expect, it } from 'vitest';
import { parseIsrcList, scopeText, scopeTitle } from '../src/pages/operations/scope-text';

describe('scope text (D-227)', () => {
  it('names the kind, the chosen ISRCs and the count of the excluded ones', () => {
    expect(scopeText(null)).toBe('—');
    expect(scopeText({ kind: 'master' })).toBe('мастер');
    expect(scopeText({ kind: 'isrcs', isrcs: ['QZTST2600001', 'QZTST2600002'] })).toBe('выбранные ISRC: QZTST2600001, QZTST2600002');
    expect(scopeText({ kind: 'master', excludeIsrcs: ['QZTST2600001', 'QZTST2600002'] })).toBe('мастер, кроме 2 ISRC');
    expect(scopeText({ kind: 'master', excludeIsrcs: [] })).toBe('мастер');
  });
  it('lists the excluded ISRCs in the tooltip only when there are some', () => {
    expect(scopeTitle({ kind: 'any', excludeIsrcs: ['A1', 'B2'] })).toBe('A1\nB2');
    expect(scopeTitle({ kind: 'any' })).toBeUndefined();
    expect(scopeTitle(null)).toBeUndefined();
  });
  it('reads a typed or pasted list: commas, spaces, new lines, semicolons; upper case, no repeats', () => {
    expect(parseIsrcList(' qztst2600001, QZTST2600002\nqztst2600001;QZTST2600003  ')).toEqual(['QZTST2600001', 'QZTST2600002', 'QZTST2600003']);
    expect(parseIsrcList('')).toEqual([]);
  });
});
