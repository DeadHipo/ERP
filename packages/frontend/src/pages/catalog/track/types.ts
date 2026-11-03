import type { TrackMoney } from '@erp/shared/api-responses';

// Shapes of the N6 response used by the track card's parts (aliases of the shared schema, no new body type).
export type Month = TrackMoney['months'][number];
export type Allocation = Month['allocations'][number];
export type Layer = Month['layers'][number];
export type Split = TrackMoney['splits'][number];
export type Participation = TrackMoney['participations'][number];

/** The key of a month row: account, UPC and report month. */
export const monthKey = (m: Month) => `${m.account}-${m.upc}-${m.reportingMonth}`;

/** `from → to` of a rule period (`valid_to` is exclusive; null = open-ended). */
export const periodText = (from: string, to: string | null, open: string) => `${from} → ${to ?? open}`;

/** The split in force on a date (ISO strings compare as text), else the newest one. */
export function splitAt(splits: readonly Split[], date: string): Split | undefined {
  const inForce = splits.find((s) => s.validFrom <= date && (s.validTo === null || date < s.validTo));
  if (inForce) return inForce;
  return [...splits].sort((a, b) => (a.validFrom < b.validFrom ? 1 : -1))[0];
}
