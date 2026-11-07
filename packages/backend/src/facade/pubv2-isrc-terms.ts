import { Decimal } from '../shared/money';
import type { PublishingTermRow } from '../modules/links';

/** What decides the percent of one song at one date (D-192). */
export type IsrcTermState =
  | { kind: 'none' }
  | { kind: 'term'; term: PublishingTermRow }
  | { kind: 'conflict'; byIsrc: { isrc: string; term: PublishingTermRow | null }[] };

const inForce = (t: PublishingTermRow, date: string) => t.validFrom <= date && (t.validTo === null || date < t.validTo);

/**
 * The term of a song through its ISRCs (D-192), pure. Only the terms of the song's owner count. No ISRC with a term →
 * `none` (the owner's own percent). Every ISRC with a term of one percent → that term. Otherwise (a version without a
 * term, or two percents) → `conflict`: B17 gives one sum per song, so nothing is guessed and the line waits.
 */
export function isrcTermOf(
  isrcs: string[],
  ownerId: string,
  date: string,
  isrcTerms: PublishingTermRow[],
  resolve: (id: string) => string,
): IsrcTermState {
  if (isrcs.length === 0) return { kind: 'none' };
  const byIsrc = [...isrcs].sort().map((isrc) => ({
    isrc,
    term: isrcTerms.find((t) => t.isrc === isrc && resolve(t.ownerId) === ownerId && inForce(t, date)) ?? null,
  }));
  const found = byIsrc.flatMap((x) => (x.term ? [x.term] : []));
  if (found.length === 0) return { kind: 'none' };
  const first = found[0] as PublishingTermRow;
  if (found.length === byIsrc.length && found.every((t) => new Decimal(t.percent).eq(first.percent))) return { kind: 'term', term: first };
  return { kind: 'conflict', byIsrc };
}

/** The owner's own term in force at a date, if any. */
export const ownerTermAt = (ownerTerms: PublishingTermRow[], ownerId: string, date: string, resolve: (id: string) => string) =>
  ownerTerms.find((t) => resolve(t.ownerId) === ownerId && inForce(t, date)) ?? null;
