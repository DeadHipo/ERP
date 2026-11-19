import type { MasterRow } from '@erp/shared/api-responses';

/**
 * The rows of a money answer at the grain `isrc` by their ISRC (D-255): how a list of tracks (the block «by
 * tracks», the P5 grid) finds the money of a track. An ISRC without a row has no units: the list shows «—» or the
 * sums of no units, by its own rule.
 */
export function rowsByIsrc(rows: readonly MasterRow[] | undefined): Map<string, MasterRow> {
  return new Map((rows ?? []).flatMap((r) => (r.isrc === undefined ? [] : [[r.isrc, r] as const])));
}
