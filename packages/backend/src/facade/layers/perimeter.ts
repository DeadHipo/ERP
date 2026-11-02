import type { Layer } from './types';

/**
 * Layer 2: a unit without ISRC (`no_isrc`) or with an ISRC + UPC pair that is not in module 1 (`unknown_pair`)
 * stays whole in C; nothing else runs (D-023, D-035).
 */
export const perimeter: Layer = (s, ctx) => {
  if (!s.unit.isrc) return { ...s, status: 'no_isrc', labelShareCategory: 'no_isrc', stopped: true };
  if (!ctx.knownPairs.has(`${s.unit.isrc}|${s.unit.upc}`))
    return { ...s, status: 'unknown_pair', labelShareCategory: 'unknown_pair', stopped: true };
  return s;
};
