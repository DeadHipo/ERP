import { describe, expect, it } from 'vitest';
import { baseTitleOf } from '@erp/shared/track-title';

// The title without its version tail (D-244): the rule of `TrackName` (D-239, D-243), computed once on the server.

describe('baseTitleOf (D-244)', () => {
  const cases: [string | null, string | null, string | null][] = [
    ['Song - Slowed', 'Slowed', 'Song'],
    ['Song', null, 'Song'],
    [null, 'X', null],
    ['Song - X', '', 'Song - X'],
    ['A - X - B', 'X', 'A - X - B'],
    ['X', 'X', 'X'],
    [' - Slowed', 'Slowed', null],
    ['', null, null],
    ['', 'X', null],
    ['Song - Slowed - Slowed', 'Slowed', 'Song - Slowed'],
  ];

  it.each(cases)('(%j, %j) → %j', (title, version, expected) => {
    expect(baseTitleOf(title, version)).toBe(expected);
  });
});
